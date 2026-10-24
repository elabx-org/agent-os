/**
 * Watches the agent sessions from the server, so phone notifications arrive
 * with no browser open: "needs you" when Claude stops at a permission
 * prompt, "finished" when it ends its turn after working.
 */

import { exec, execFile } from "child_process";
import { promisify } from "util";
import { statusDetector, type SessionStatus } from "../status-detector";
import {
  getManagedSessionPattern,
  getSessionIdFromName,
} from "../providers/registry";
import { getDb, queries, type Project, type Session } from "../db";
import { parsePermissionPrompt } from "../permission-prompt";
import { findTranscript, readTranscript } from "../claude-transcript";
import { isWatching, readPushConfig } from "./config";
import { sendPush, type PushMessage } from "./send";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const POLL_MS = 3000;
/** Work shorter than this ending is not worth a "finished" */
const MIN_WORK_MS = 20_000;

interface Track {
  /** The status acted on, after it read the same twice in a row */
  stable: SessionStatus;
  candidate: SessionStatus;
  runningSince: number | null;
}

const tracks = new Map<string, Track>();

async function managedSessions(): Promise<string[]> {
  const pattern = getManagedSessionPattern();
  try {
    const { stdout } = await execAsync(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null || true"
    );
    return stdout.split("\n").filter((name) => pattern.test(name));
  } catch {
    return [];
  }
}

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
      if (item.kind === "user") return null;
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
): Promise<PushMessage | null> {
  const db = getDb();
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session || session.conductor_session_id) return null;
  const project = session.project_id
    ? (queries.getProject(db).get(session.project_id) as Project | undefined)
    : undefined;
  const where =
    project && !project.is_uncategorized
      ? `${project.name} · ${session.name}`
      : session.name;

  if (kind === "needsYou") {
    const p = await prompt(tmuxName);
    if (!p) return null;
    const what = [p.title, p.detail || p.description]
      .filter(Boolean)
      .join(": ");
    return {
      kind,
      sessionId: id,
      title: `Needs you · ${where}`,
      body: clip(what || p.question || "Claude is asking a question", 240),
    };
  }
  const reply = await lastReply(tmuxName);
  return {
    kind,
    sessionId: id,
    title: `Finished · ${where}`,
    body: reply ? clip(reply, 240) : "Claude is waiting for your reply",
  };
}

async function poll(): Promise<void> {
  const config = readPushConfig();
  const channels = config.ntfy.enabled || config.apns.enabled;
  const names = await managedSessions();
  const seen = new Set<string>();

  for (const tmuxName of names) {
    seen.add(tmuxName);
    const status = await statusDetector.getStatus(tmuxName);
    const track = tracks.get(tmuxName);
    if (!track) {
      // First sight (or a server restart): learn, don't announce
      tracks.set(tmuxName, {
        stable: status,
        candidate: status,
        runningSince: status === "running" ? Date.now() : null,
      });
      continue;
    }
    if (status !== track.candidate) {
      track.candidate = status;
      continue;
    }
    if (status === track.stable) continue;

    const before = track.stable;
    const workedMs = track.runningSince ? Date.now() - track.runningSince : 0;
    track.stable = status;
    track.runningSince = status === "running" ? Date.now() : null;

    if (!channels || status !== "waiting") continue;
    const id = getSessionIdFromName(tmuxName);
    if (isWatching(id)) continue;

    // A permission prompt can appear without a working spell before it
    const p = await prompt(tmuxName);
    const kind = p ? "needsYou" : "finished";
    if (kind === "needsYou" && !config.events.needsYou) continue;
    if (kind === "finished") {
      if (!config.events.finished) continue;
      if (before !== "running" || workedMs < MIN_WORK_MS) continue;
    }
    const msg = await message(tmuxName, id, kind);
    if (!msg) continue;
    sendPush(msg).then((report) =>
      console.log(`[push] ${msg.title}:`, JSON.stringify(report))
    );
  }

  for (const name of tracks.keys()) {
    if (!seen.has(name)) tracks.delete(name);
  }
}

export function startPushWatcher(): void {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await poll();
    } catch (error) {
      console.error("[push] watcher:", error);
    } finally {
      busy = false;
    }
  }, POLL_MS).unref();
}
