/**
 * What agents tried to do to other sessions' permissions (answer a
 * permission request, press Shift+Tab, change the mode...), allowed or
 * refused: the agent_actions table, shown on the permission card.
 */

export const AGENT_ACTOR_HEADER = "x-agentos-actor";

export type AgentActionKind =
  | "prompt_answer"
  | "keys"
  | "send_keys"
  | "permission_mode"
  | "spawn"
  | "summarize";

export interface NewAgentAction {
  actorSessionId?: string | null;
  actorTmux?: string | null;
  targetSessionId: string;
  action: AgentActionKind;
  allowed: boolean;
  detail?: string | null;
  /** ms; defaults to now */
  at?: number;
}

/** GET /api/sessions/[id]/agent-actions → {actions: AgentAction[]} */
export interface AgentAction {
  /** Display name: the actor session's name, else its tmux name */
  actor: string | null;
  actorSessionId: string | null;
  action: AgentActionKind;
  allowed: boolean;
  detail: string | null;
  at: number;
}

export function recordAgentAction(_row: NewAgentAction): void {
  throw new Error("not implemented");
}

/** Newest first, at > since (ms) */
export function listAgentActions(
  _sessionId: string,
  _since?: number
): AgentAction[] {
  throw new Error("not implemented");
}
