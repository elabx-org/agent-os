/**
 * Watches the agent sessions from the server, so phone notifications arrive
 * with no browser open: "needs you" when Claude stops at a permission
 * prompt, "finished" when it ends its turn after working. Background agents
 * get the same two events. Every event lands in the history
 * (lib/push/history.ts) whether or not a push goes out.
 */

import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  onEdge,
  startSessionWatch,
  wantWatch,
  type WatchEdge,
} from "../session-watch";
import { getDb, queries, type Project, type Session } from "../db";
import { parsePermissionPrompt } from "../permission-prompt";
import { findTranscript, readTranscript } from "../claude-transcript";
import {
  backgroundAgentConversation,
  cachedBackgroundAgents,
  type BackgroundAgent,
} from "../claude-background";
import { isWatching, readPushConfig } from "./config";
import { sendPush, type PushMessage } from "./send";
import { recordNotification, setDelivered } from "./history";
import { tickersDisabled } from "../flags";
import { isEnded } from "../settle-types";

const execFileAsync = promisify(execFile);

/** `claude agents` is slow, so background agents get a loop of their own */
const AGENT_POLL_MS = 10_000;
/** Work shorter than this ending is not worth a "finished" */
const MIN_WORK_MS = 20_000;

/** A push, plus the project the history files it under */
type Event = PushMessage & { projectName?: string };

async function prompt(tmuxName: string) {
  try {
    const [{ stdout: pane }, { stdout: width }] = await Promise.all([
      execFileAsync("tmux", ["capture-pane", "-t", tmuxName, "-p"]),
      execFileAsync("tmux", [
        "display-message",
        "-t",
        tmuxName,
        "-p",
        "#{pane_width}",
      ]),
    ]);
    return parsePermissionPrompt(pane.split("\n"), Number(width) || 80);
  } catch {
    return null;
  }
}

async function lastReply(tmuxName: string): Promise<string | null> {
  try {
    const found = await findTranscript(tmuxName);
    if (!found?.file) return null;
    const { items } = readTranscript(found.file, found.sessionId, found.cwd);
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "assistant" && item.text.trim()) return item.text;
      if (item.kind === "user" || item.kind === "summary") return null;
    }
  } catch {
    // No transcript to read
  }
  return null;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function message(
  tmuxName: string,
  id: string,
  kind: "needsYou" | "finished"
): Promise<Event | null> {
  const db = getDb();
  const session = queries.getSession(db).get(id) as Session | undefined;
  // Settled or paused: its tmux was ended on purpose, nothing to announce
  if (!session || session.conductor_session_id || isEnded(session)) return null;
  const project = session.project_id
    ? (queries.getProject(db).get(session.project_id) as Project | undefined)
    : undefined;
  const projectName =
    project && !project.is_uncategorized ? project.name : undefined;
  const where = projectName ? `${projectName} · ${session.name}` : session.name;

  if (kind === "needsYou") {
    const p = await prompt(tmuxName);
    if (!p) return null;
    const what = [p.title, p.detail || p.description]
      .filter(Boolean)
      .join(": ");
    return {
      kind,
      sessionId: id,
      projectName,
      title: `Needs you · ${where}`,
      body: clip(what || p.question || "Claude is asking a question", 240),
    };
  }
  const reply = await lastReply(tmuxName);
  return {
    kind,
    sessionId: id,
    projectName,
    title: `Finished · ${where}`,
    body: reply ? clip(reply, 240) : "Claude is waiting for your reply",
  };
}

/**
 * What a stable change to "waiting" announces: needsYou when a permission
 * prompt is up (one can appear without a working spell before it), else
 * finished, but only after at least MIN_WORK_MS of work
 */
export function edgeKind(
  edge: WatchEdge,
  hasPrompt: boolean
): "needsYou" | "finished" | null {
  if (edge.to !== "waiting") return null;
  if (hasPrompt) return "needsYou";
  if (edge.from !== "running" || edge.workedMs < MIN_WORK_MS) return null;
  return "finished";
}

async function onWatchEdge(edge: WatchEdge): Promise<void> {
  if (edge.to !== "waiting") return;
  const config = readPushConfig();
  const channels = config.ntfy.enabled || config.apns.enabled;
  const kind = edgeKind(edge, (await prompt(edge.tmuxName)) !== null);
  if (!kind) return;
  const msg = await message(edge.tmuxName, edge.sessionId, kind);
  if (!msg) return;

  // The history keeps it even when nothing is sent
  announce(msg, channels && config.events[kind] && !isWatching(edge.sessionId));
}

/** Records the event, then sends it when `push` */
function announce(msg: Event, push: boolean) {
  const { kind, title, body, sessionId, agentId, projectName } = msg;
  const entry = recordNotification({
    kind,
    title,
    body,
    sessionId,
    agentId,
    projectName,
  });
  if (!push) return;
  sendPush(msg).then((report) => {
    console.log(`[push] ${title}:`, JSON.stringify(report));
    setDelivered(entry.id, report);
  });
}

/** Background agents by id: the state last seen */
const agentStates = new Map<string, string>();
let agentsLearned = false;

/** The deepest project folder holding the agent, else its folder's name */
function agentProject(agent: BackgroundAgent): string {
  const home = process.env.HOME || "";
  const full = (dir: string) =>
    dir.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "");
  const cwd = full(agent.cwd);
  let best: Project | undefined;
  for (const project of queries.getAllProjects(getDb()).all() as Project[]) {
    if (project.is_uncategorized) continue;
    const dir = full(project.working_directory);
    if (cwd !== dir && !cwd.startsWith(dir + "/")) continue;
    if (!best || dir.length > full(best.working_directory).length)
      best = project;
  }
  return best?.name ?? path.basename(cwd);
}

function lastAgentReply(agent: BackgroundAgent): string | null {
  try {
    const items = backgroundAgentConversation(agent) ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "assistant" && item.text.trim()) return item.text;
      if (item.kind === "user") return null;
    }
  } catch {
    // No conversation to read
  }
  return null;
}

/** A failing CLI (not installed yet, too old) is told once, then retried less */
let agentsError: string | null = null;
let agentsSkip = 0;
let agentsBackoff = 0;

async function pollAgents(): Promise<void> {
  if (agentsSkip > 0) {
    agentsSkip--;
    return;
  }
  let agents: BackgroundAgent[];
  try {
    agents = await cachedBackgroundAgents();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text !== agentsError) console.error("[push] background agents:", text);
    agentsError = text;
    // Up to about 5 minutes between tries
    agentsBackoff = Math.min(agentsBackoff * 2 || 1, 32);
    agentsSkip = agentsBackoff;
    return;
  }
  agentsError = null;
  agentsBackoff = 0;
  const config = readPushConfig();
  const channels = config.ntfy.enabled || config.apns.enabled;
  const seen = new Set<string>();

  for (const agent of agents) {
    // A parked session is still that session: its own track covers it
    if (agent.agentOsSessionId) continue;
    seen.add(agent.id);
    // A state the CLI couldn't name isn't a change worth telling
    if (!agent.state || agent.state === "unknown") continue;
    const before = agentStates.get(agent.id);
    agentStates.set(agent.id, agent.state);
    // The first list after a restart only learns; a new agent counts from
    // where it was first seen
    if (!agentsLearned || before === agent.state) continue;

    const projectName = agentProject(agent);
    if (agent.state === "blocked") {
      const msg: Event = {
        kind: "agentNeedsYou",
        agentId: agent.id,
        projectName,
        title: `Needs you · ${projectName}`,
        body: clip(`${agent.name} is waiting for you`, 240),
      };
      announce(msg, channels && config.events.needsYou);
    } else if (before === "working" && agent.state !== "working") {
      const reply = lastAgentReply(agent);
      const ended = agent.state === "done" ? "Finished" : clip(agent.state, 20);
      const msg: Event = {
        kind: "agentFinished",
        agentId: agent.id,
        projectName,
        title: `${ended[0].toUpperCase()}${ended.slice(1)} · ${projectName}`,
        body: clip(reply ? `${agent.name}: ${reply}` : agent.name, 240),
      };
      announce(msg, channels && config.events.backgroundFinished);
    }
  }
  agentsLearned = true;

  for (const id of agentStates.keys()) {
    if (!seen.has(id)) agentStates.delete(id);
  }
}

/** Runs `fn` every `ms`, skipping a beat while the last run is still going */
function every(ms: number, fn: () => Promise<void>) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (error) {
      console.error("[push] watcher:", error);
    } finally {
      busy = false;
    }
  }, ms).unref();
}

export function startPushWatcher(): void {
  if (process.env.AGENTOS_DISABLE_PUSH === "1" || tickersDisabled()) return;
  // The sessions come from the one shared poll (lib/session-watch.ts)
  onEdge((edge) => {
    onWatchEdge(edge).catch((error) => console.error("[push] watcher:", error));
  });
  wantWatch(() => true);
  startSessionWatch();
  every(AGENT_POLL_MS, pollAgents);
}
