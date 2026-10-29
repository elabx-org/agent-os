/**
 * The family tree of a session's agents (M13). `buildAgentTree` merges what
 * was read into one tree and is pure, so it is tested on fixtures;
 * `loadAgentTree` reads it for a session (transcript, subagents,
 * workflows, linked sessions, background agents).
 */

import type { Session } from "./db";
import type { SubagentInfo } from "./claude-subagents";
import type { WorkflowInfo } from "./claude-workflows";
import type { BackgroundAgent } from "./claude-background";
import type {
  AgentTreeResponse,
  TreeCounts,
  TreeNode,
} from "./agent-tree-types";

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
}

export const NO_COUNTS: TreeCounts = {
  asking: 0,
  working: 0,
  done: 0,
  failed: 0,
  queued: 0,
};

/** The session's own node, with no children */
export function sessionNode(session: Session): TreeNode {
  return {
    id: `session:${session.id}`,
    kind: "session",
    title: session.name,
    subtitle: null,
    state: "idle",
    agentType: session.agent_type,
    model: null,
    tokens: null,
    startedAt: session.created_at,
    updatedAt: session.updated_at,
    finishedAt: null,
    sessionId: session.id,
    agentId: null,
    children: [],
  };
}

/** Contract stub (U13.1 builds the merge) */
export function buildAgentTree(input: AgentTreeInput): AgentTreeResponse {
  return {
    root: sessionNode(input.session),
    children: [],
    counts: { ...NO_COUNTS },
    total: 0,
  };
}

/** The tree for a session; null if there is no such session. Contract stub */
export async function loadAgentTree(
  _sessionId: string
): Promise<AgentTreeResponse | null> {
  return null;
}
