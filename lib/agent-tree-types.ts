/**
 * The family tree of a session's agents (M13: N-Tree, O-Tree, D-Tree), as
 * the tree route returns it. No server imports: the tree, the graph and the
 * detail pane read these on the client.
 *
 * One tree merges everything a session started: its workflows, each
 * workflow's phases (a declared phase with no agents yet is queued), the
 * agents in each phase, plain subagents (the Agent tool), forks and
 * handoffs (other Agent-OS sessions linked by parent_session_id or
 * handoff_*), conductor workers and background agents (`claude --bg`).
 */

import type { AgentState } from "./agent-state";
import type { AgentType } from "./providers";

export type TreeNodeKind =
  /** The session the tree is for (the root) */
  | "session"
  /** A Workflow tool run */
  | "workflow"
  /** One of a workflow's declared phases */
  | "phase"
  /** An agent a workflow started, in its phase */
  | "agent"
  /** A plain subagent (the Agent tool) */
  | "subagent"
  /** An Agent-OS session forked from this one (parent_session_id) */
  | "fork"
  /** An Agent-OS session this one was handed to (M4 handoff_*) */
  | "handoff"
  /** A conductor's worker session (conductor_session_id) */
  | "worker"
  /** A `claude --bg` background agent started from this session */
  | "background";

/** What Stop calls for a node; absent where there is no stop API */
export interface TreeNodeStop {
  /** worker: DELETE /api/orchestrate/workers/[id]; background: DELETE /api/background-agents/[id] */
  kind: "worker" | "background";
  id: string;
}

export interface TreeNode {
  /**
   * Unique within the tree and stable across polls: "session:<id>",
   * "wf:<runId>", "phase:<runId>:<index>", "agent:<agentId>",
   * "bg:<backgroundId>"
   */
  id: string;
  kind: TreeNodeKind;
  /** "agentos-feature-mocks", "Design", "undo-diff", "Explore", a session name */
  title: string;
  /**
   * The line under the title: what it does now or did ("Writing
   * O-Undo.dc.html", "Wants to run mockshot.js", "12 tool uses · found 29
   * screens", "Workflow · phase 1 of 2", "3 agents · 1 done", "queued after
   * Design"); null when there is nothing to say
   */
  subtitle: string | null;
  /** The shared state model (lib/agent-state.ts): needs = asking you */
  state: AgentState;
  /** Whose avatar (C, X…): the agent kinds and sessions; null for workflow and phase */
  agentType: AgentType | null;
  /** "Opus 5.5", "Sonnet 4.6"; null when unknown */
  model: string | null;
  /** Context at its latest turn; null when unknown */
  tokens: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  /** When it finished (done/failed/stopped); null while running or unknown */
  finishedAt: string | null;
  /** The Agent-OS session a fork, handoff or worker is (opens it) */
  sessionId: string | null;
  /** The subagent id, for /subagents/[agentId] (agent, subagent, background) */
  agentId: string | null;
  /** A workflow's place: phase index (1-based) of the total declared */
  workflow?: { phase: number; phases: number };
  /** A phase: how many agents ran or run in it, how many are done, the phase it waits on */
  phase?: { agents: number; done: number; after: string | null };
  /** The small pill beside the title: Fork, Handoff, Worker, Background */
  badge?: "Fork" | "Handoff" | "Worker" | "Background";
  /** Only background agents and workers can be stopped (in-session subagents have no stop API) */
  stop?: TreeNodeStop;
  children: TreeNode[];
}

/** How many agents are in each state, for "1 asking · 3 working · 2 done · 1 queued" */
export interface TreeCounts {
  asking: number;
  working: number;
  done: number;
  failed: number;
  queued: number;
}

/** GET /api/sessions/[id]/tree */
export interface AgentTreeResponse {
  /** The session itself, with `children` empty (they are below) */
  root: TreeNode;
  /** The top level under the session, oldest first */
  children: TreeNode[];
  counts: TreeCounts;
  /** Every agent node under the root (not workflows or phases): "Agents · 7" */
  total: number;
}

/** One of the "Last 4 tool calls" rows */
export interface ToolCallSummary {
  /** The tool's name as Claude Code records it: Read, Write, Edit, Bash, … */
  tool: string;
  /** "Read", "Wrote", "Edited", "Ran", "Searched"; "Writing" while running */
  verb: string;
  /** The file's base name or the command's first words, shown in mono */
  target: string;
  at: string;
  /** The call has no result yet (the green dot, "now") */
  running: boolean;
}

/** One of "Files it wrote" */
export interface WrittenFile {
  /** Path relative to the session's folder */
  path: string;
  /** Lines added across its writes and edits */
  added: number;
  /** Lines removed (edits only) */
  removed: number;
}

/** GET /api/sessions/[id]/subagents/[agentId] */
export interface SubagentDetail {
  agentId: string;
  /** What it was asked to do: the first user message of its conversation */
  prompt: string | null;
  /** The last four tool calls, oldest first */
  lastTools: ToolCallSummary[];
  filesWritten: WrittenFile[];
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  } | null;
  model: string | null;
  /** Context at its latest turn (the bar's "48k") */
  tokens: number | null;
  /** The model's window (the bar's "of 200k") */
  contextWindow: number | null;
  updatedAt: string | null;
}
