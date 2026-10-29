/**
 * The family tree of a session's agents (M13). `buildAgentTree` merges what
 * was read into one tree and is pure, so it is tested on fixtures;
 * `loadAgentTree` reads it for a session (transcript, subagents,
 * workflows, linked sessions, background agents).
 */

import path from "path";
import { getDb, queries, type Session } from "./db";
import { listSubagents, subagentFile } from "./claude-subagents";
import type { SubagentInfo } from "./claude-subagents";
import { listWorkflows } from "./claude-workflows";
import type { WorkflowInfo } from "./claude-workflows";
import { cachedBackgroundAgents } from "./claude-background";
import type { BackgroundAgent } from "./claude-background";
import { findTranscript } from "./claude-transcript";
import {
  fromBackgroundState,
  fromSessionStatus,
  fromSubagentStatus,
  dbTimeMs,
  type AgentState,
} from "./agent-state";
import { getProvider } from "./providers";
import {
  canAsk,
  lastTool,
  logModel,
  logTokens,
  readAgentLog,
} from "./agent-tree-log";
import { linkBackground, mentionedIds, sessionUsage } from "./agent-tree-links";
import type {
  AgentTreeResponse,
  ToolCallSummary,
  TreeCounts,
  TreeNode,
} from "./agent-tree-types";

/** What an agent's own conversation says it is doing (agent-tree-log.ts) */
export interface AgentActivity {
  /** Its latest tool call */
  last: ToolCallSummary | null;
  /** "Wants to run mockshot.js": the latest call as a question */
  wants: string | null;
  /** The latest call is one that can ask for permission */
  canAsk: boolean;
  steps: number;
  /** Base names of the files it wrote */
  files: string[];
  model: string | null;
  tokens: number | null;
}

export interface AgentTreeInput {
  session: Session;
  /** listSubagents() of its transcript */
  subagents: SubagentInfo[];
  /** listWorkflows() of its transcript */
  workflows: WorkflowInfo[];
  /**
   * Agent-OS sessions linked to it: forks (parent_session_id), handoffs
   * (handoff_from_session_id, once M4 adds it) and conductor workers
   */
  related: Session[];
  /** Background agents started from it */
  background: BackgroundAgent[];
  /** Date.now(), passed in for tests */
  now: number;
  /** What each agent is doing, by agentId, where it was read */
  activity?: Record<string, AgentActivity>;
  /** The session's own model and context, from its transcript */
  usage?: { model: string | null; tokens: number | null };
}

export const NO_COUNTS: TreeCounts = {
  asking: 0,
  working: 0,
  done: 0,
  failed: 0,
  queued: 0,
};

/** A DB or ISO time as ISO; null if unreadable */
function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = dbTimeMs(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The session's own node, with no children */
export function sessionNode(session: Session): TreeNode {
  return {
    id: `session:${session.id}`,
    kind: "session",
    title: session.name,
    subtitle: null,
    state: fromSessionStatus(session.status),
    agentType: session.agent_type,
    model: null,
    tokens: null,
    startedAt: iso(session.created_at),
    updatedAt: iso(session.updated_at),
    finishedAt: null,
    sessionId: session.id,
    agentId: null,
    children: [],
  };
}

const FINISHED: AgentState[] = ["done", "error", "stopped"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The line under an agent: what it does now, or what it did */
function agentSubtitle(
  state: AgentState,
  activity: AgentActivity | undefined,
  steps: number | null
): string | null {
  if (state === "needs" && activity?.wants) return activity.wants;
  const last = activity?.last;
  if (state === "work" && last)
    return `${last.verb} ${last.target}`.trim() || null;
  if (activity?.files.length)
    return activity.files.length === 1
      ? `Wrote ${activity.files[0]}`
      : `Wrote ${activity.files.length} files`;
  const n = activity?.steps ?? steps;
  if (n) return plural(n, "tool use");
  if (state === "work" && last) return `${last.verb} ${last.target}`.trim();
  return null;
}

function agentLeaf(
  base: Omit<TreeNode, "subtitle" | "model" | "tokens" | "children">,
  activity: AgentActivity | undefined,
  steps: number | null,
  model: string | null,
  tokens: number | null
): TreeNode {
  return {
    ...base,
    subtitle: agentSubtitle(base.state, activity, steps),
    model: activity?.model ?? model,
    tokens: activity?.tokens ?? tokens,
    children: [],
  };
}

function phaseState(
  agents: TreeNode[],
  run: WorkflowInfo["status"]
): AgentState {
  if (!agents.length)
    return run === "running"
      ? "queued"
      : run === "done"
        ? "done"
        : run === "failed"
          ? "error"
          : "stopped";
  if (agents.some((a) => a.state === "needs")) return "needs";
  if (agents.some((a) => a.state === "work")) return "work";
  if (agents.every((a) => a.state === "done")) return "done";
  return run === "failed" ? "error" : "stopped";
}

function workflowNode(
  run: WorkflowInfo,
  agentNode: (agentId: string) => TreeNode | undefined
): TreeNode {
  const names = [...run.phases];
  for (const a of run.agents) {
    const name = a.phase ?? "Other";
    if (!names.includes(name)) names.push(name);
  }
  const finished = run.status !== "running";
  const phases: TreeNode[] = names.map((name, i) => {
    const agents = run.agents
      .filter((a) => (a.phase ?? "Other") === name)
      .map((a) => agentNode(a.agentId))
      .filter((n): n is TreeNode => !!n);
    const state = phaseState(agents, run.status);
    const done = agents.filter((a) => a.state === "done").length;
    const after = i > 0 ? names[i - 1] : null;
    const tokens = agents.reduce((sum, a) => sum + (a.tokens ?? 0), 0);
    return {
      id: `phase:${run.runId}:${i}`,
      kind: "phase",
      title: name,
      subtitle: agents.length
        ? `${plural(agents.length, "agent")} · ${done} done`
        : state === "queued"
          ? after
            ? `queued after ${after}`
            : "queued"
          : null,
      state,
      agentType: null,
      model: null,
      tokens: tokens || null,
      startedAt: null,
      updatedAt: null,
      finishedAt: null,
      sessionId: null,
      agentId: null,
      phase: { agents: agents.length, done, after },
      children: agents,
    };
  });
  const current = names.indexOf(run.phase ?? "");
  const state: AgentState =
    run.status === "running"
      ? phases.some((p) => p.state === "needs")
        ? "needs"
        : "work"
      : run.status === "done"
        ? "done"
        : run.status === "failed"
          ? "error"
          : "stopped";
  const tokens = phases.reduce((sum, p) => sum + (p.tokens ?? 0), 0);
  return {
    id: `wf:${run.runId}`,
    kind: "workflow",
    title: run.name,
    subtitle: !names.length
      ? "Workflow"
      : finished
        ? `Workflow · ${plural(names.length, "phase")}`
        : `Workflow · phase ${Math.max(current, 0) + 1} of ${names.length}`,
    state,
    agentType: null,
    model: null,
    tokens: tokens || null,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: finished ? run.updatedAt : null,
    sessionId: null,
    agentId: null,
    workflow: { phase: Math.max(current, 0) + 1, phases: names.length },
    children: phases,
  };
}

/** How a linked Agent-OS session relates: worker, handoff or fork */
function relatedKind(
  session: Session,
  other: Session
): "worker" | "handoff" | "fork" | null {
  if (other.id === session.id) return null;
  if (other.conductor_session_id === session.id) return "worker";
  const from = (other as unknown as Record<string, unknown>)
    .handoff_from_session_id;
  if (from === session.id) return "handoff";
  if (other.parent_session_id === session.id) return "fork";
  return null;
}

function workerState(other: Session): AgentState {
  switch (other.worker_status) {
    case "pending":
      return "queued";
    case "completed":
      return "done";
    case "failed":
      return "error";
    default:
      return fromSessionStatus(other.status);
  }
}

const BADGE = {
  worker: "Worker",
  handoff: "Handoff",
  fork: "Fork",
} as const;

function relatedNode(session: Session, other: Session): TreeNode | null {
  const kind = relatedKind(session, other);
  if (!kind) return null;
  const state =
    kind === "worker" ? workerState(other) : fromSessionStatus(other.status);
  let provider: string;
  try {
    provider = getProvider(other.agent_type).name;
  } catch {
    provider = String(other.agent_type);
  }
  const task = kind === "worker" ? other.worker_task?.trim() : "";
  const updatedAt = iso(other.updated_at);
  return {
    id: `session:${other.id}`,
    kind,
    title: other.name,
    subtitle: task
      ? `${provider} · ${task.length > 60 ? task.slice(0, 59) + "…" : task}`
      : provider,
    state,
    agentType: other.agent_type,
    model: null,
    tokens: null,
    startedAt: iso(other.created_at),
    updatedAt,
    finishedAt: FINISHED.includes(state) ? updatedAt : null,
    sessionId: other.id,
    agentId: null,
    badge: BADGE[kind],
    ...(kind === "worker" && !FINISHED.includes(state)
      ? { stop: { kind: "worker" as const, id: other.id } }
      : {}),
    children: [],
  };
}

function backgroundNode(agent: BackgroundAgent): TreeNode {
  const state = fromBackgroundState(agent.state);
  const startedAt = agent.startedAt
    ? new Date(agent.startedAt).toISOString()
    : null;
  return {
    id: `bg:${agent.id}`,
    kind: "background",
    title: agent.name,
    subtitle: agent.state === "blocked" ? "Waiting on you" : null,
    state,
    agentType: "claude",
    model: null,
    tokens: null,
    startedAt,
    updatedAt: null,
    finishedAt: null,
    sessionId: null,
    agentId: agent.id,
    badge: "Background",
    ...(FINISHED.includes(state)
      ? {}
      : { stop: { kind: "background" as const, id: agent.id } }),
    children: [],
  };
}

const AGENT_KINDS = new Set<TreeNode["kind"]>([
  "agent",
  "subagent",
  "fork",
  "handoff",
  "worker",
  "background",
]);

function walk(nodes: TreeNode[], fn: (node: TreeNode) => void) {
  for (const node of nodes) {
    fn(node);
    walk(node.children, fn);
  }
}

function startMs(node: TreeNode): number {
  const ms = node.startedAt ? Date.parse(node.startedAt) : NaN;
  return Number.isNaN(ms) ? Infinity : ms;
}

/**
 * The merged tree: workflows (their declared phases in order, a phase with
 * no agents yet queued after the one before), plain subagents, linked
 * sessions and background agents, oldest first. An agent shows once, under
 * its workflow when it has one.
 *
 * Asking: when the session waits on a permission and exactly one running
 * agent's latest call is unanswered and can ask, that agent is the one
 * asking. With several such agents it can't be told which, so none is.
 */
export function buildAgentTree(input: AgentTreeInput): AgentTreeResponse {
  const { session, activity = {} } = input;

  // Which running agent the session's prompt is for
  const pending = [
    ...input.workflows.flatMap((w) =>
      w.agents.filter((a) => a.status === "running").map((a) => a.agentId)
    ),
    ...input.subagents
      .filter((s) => s.status === "running")
      .map((s) => s.agentId),
  ].filter((id) => {
    const a = activity[id];
    return a?.last?.running && a.canAsk;
  });
  const asking =
    session.status === "waiting" && new Set(pending).size === 1
      ? pending[0]
      : null;

  const seen = new Set<string>();
  const stateOf = (agentId: string, status: string): AgentState =>
    agentId === asking ? "needs" : fromSubagentStatus(status);

  const workflowAgents = new Map<string, TreeNode>();
  for (const run of input.workflows)
    for (const a of run.agents) {
      if (seen.has(a.agentId)) continue;
      seen.add(a.agentId);
      const state = stateOf(a.agentId, a.status);
      workflowAgents.set(
        a.agentId,
        agentLeaf(
          {
            id: `agent:${a.agentId}`,
            kind: "agent",
            title: a.label,
            state,
            agentType: "claude",
            startedAt: null,
            updatedAt: null,
            finishedAt: null,
            sessionId: null,
            agentId: a.agentId,
          },
          activity[a.agentId],
          null,
          a.model,
          a.tokens
        )
      );
    }

  const top: TreeNode[] = input.workflows.map((run) =>
    workflowNode(run, (id) => workflowAgents.get(id))
  );
  for (const s of input.subagents) {
    if (seen.has(s.agentId)) continue;
    seen.add(s.agentId);
    const state = stateOf(s.agentId, s.status);
    top.push(
      agentLeaf(
        {
          id: `agent:${s.agentId}`,
          kind: "subagent",
          title: s.description || s.agentType || "Agent",
          state,
          agentType: "claude",
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          finishedAt: FINISHED.includes(state) ? s.updatedAt : null,
          sessionId: null,
          agentId: s.agentId,
        },
        activity[s.agentId],
        s.steps,
        null,
        null
      )
    );
  }
  const seenSessions = new Set<string>();
  for (const other of input.related) {
    if (seenSessions.has(other.id)) continue;
    const node = relatedNode(session, other);
    if (!node) continue;
    seenSessions.add(other.id);
    top.push(node);
  }
  const seenBg = new Set<string>();
  for (const agent of input.background) {
    if (seenBg.has(agent.id)) continue;
    seenBg.add(agent.id);
    top.push(backgroundNode(agent));
  }
  // Oldest first; stable for equal or unknown starts
  const children = top
    .map((node, i) => ({ node, i }))
    .sort((a, b) => startMs(a.node) - startMs(b.node) || a.i - b.i)
    .map((x) => x.node);

  const counts = { ...NO_COUNTS };
  let total = 0;
  walk(children, (node) => {
    if (node.kind === "phase" && node.state === "queued") counts.queued++;
    if (!AGENT_KINDS.has(node.kind)) return;
    total++;
    if (node.state === "needs") counts.asking++;
    else if (node.state === "work") counts.working++;
    else if (node.state === "done") counts.done++;
    else if (node.state === "error") counts.failed++;
    else if (node.state === "queued") counts.queued++;
  });

  const root = sessionNode(session);
  root.model = input.usage?.model ?? null;
  root.tokens = input.usage?.tokens ?? null;
  const runningWorkflow = input.workflows.some((w) => w.status === "running");
  const runningAgents = children.filter(
    (n) => n.kind === "subagent" && n.state === "work"
  ).length;
  root.subtitle = runningWorkflow
    ? "waiting on the workflow"
    : runningAgents
      ? runningAgents === 1
        ? "waiting on an agent"
        : `waiting on ${runningAgents} agents`
      : null;

  return { root, children, counts, total };
}

/** What a conversation says, for the tree (null if it can't be read) */
export function activityOf(file: string): AgentActivity | null {
  const log = readAgentLog(file);
  if (!log) return null;
  const last = lastTool(log);
  const latest = log.tools.at(-1);
  return {
    last,
    wants: latest?.running ? latest.wants : null,
    canAsk: latest ? canAsk(latest.tool) : false,
    steps: log.steps,
    files: [...log.files.keys()].map((f) => path.basename(f)),
    model: logModel(log),
    tokens: logTokens(log),
  };
}

/** Background agents: the CLI is never waited on longer than this */
const BACKGROUND_WAIT_MS = 300;
/** One answer serves the polls of every open view for this long */
const TREE_CACHE_MS = 1500;

const treeCache = globalThis as unknown as {
  __agentosTrees?: Map<
    string,
    { at: number; promise: Promise<AgentTreeResponse | null> }
  >;
};

async function backgroundSoon(): Promise<BackgroundAgent[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      cachedBackgroundAgents(),
      new Promise<BackgroundAgent[]>((resolve) => {
        timer = setTimeout(() => resolve([]), BACKGROUND_WAIT_MS);
      }),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function relatedSessions(sessionId: string): Session[] {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT * FROM sessions WHERE parent_session_id = ?
         OR conductor_session_id = ? OR handoff_from_session_id = ?`
      )
      .all(sessionId, sessionId, sessionId) as Session[];
  } catch {
    // Before M4's migration there is no handoff column
    return db
      .prepare(
        "SELECT * FROM sessions WHERE parent_session_id = ? OR conductor_session_id = ?"
      )
      .all(sessionId, sessionId) as Session[];
  }
}

async function readTree(sessionId: string): Promise<AgentTreeResponse | null> {
  const session = queries.getSession(getDb()).get(sessionId) as
    | Session
    | undefined;
  if (!session) return null;
  const related = relatedSessions(session.id);
  const now = Date.now();
  if (session.agent_type !== "claude")
    return buildAgentTree({
      session,
      subagents: [],
      workflows: [],
      related,
      background: [],
      now,
    });

  const found = await findTranscript(
    session.tmux_name || `claude-${sessionId}`
  );
  const file = found?.file ?? null;
  const subagents = file ? listSubagents(file) : [];
  const workflows = file ? listWorkflows(file) : [];

  // Each agent's own conversation, where the tree shows what it does: the
  // running ones, plain subagents, and the agents of a running workflow (a
  // finished workflow's agents were read for their usage already)
  const activity: Record<string, AgentActivity> = {};
  if (file) {
    const ids = [
      ...subagents.map((s) => s.agentId),
      ...workflows
        .filter((w) => w.status === "running")
        .flatMap((w) => w.agents.map((a) => a.agentId)),
    ];
    for (const id of ids) {
      const conv = subagentFile(file, id);
      const a = conv ? activityOf(conv) : null;
      if (a) activity[id] = a;
    }
  }

  let background: BackgroundAgent[] = [];
  if (file) {
    const candidates = linkBackground(session, await backgroundSoon(), null);
    if (candidates.length) {
      const mentioned = mentionedIds(
        file,
        candidates.map((a) => a.id)
      );
      background = linkBackground(session, candidates, mentioned);
    }
  }

  return buildAgentTree({
    session,
    subagents,
    workflows,
    related,
    background,
    now,
    activity,
    usage: file ? sessionUsage(file) : undefined,
  });
}

/** The tree for a session; null if there is no such session */
export async function loadAgentTree(
  sessionId: string
): Promise<AgentTreeResponse | null> {
  const cache = (treeCache.__agentosTrees ??= new Map());
  const hit = cache.get(sessionId);
  if (hit && Date.now() - hit.at < TREE_CACHE_MS) return hit.promise;
  const promise = readTree(sessionId);
  for (const [id, entry] of cache)
    if (Date.now() - entry.at > TREE_CACHE_MS) cache.delete(id);
  cache.set(sessionId, { at: Date.now(), promise });
  promise.catch(() => cache.delete(sessionId));
  return promise;
}
