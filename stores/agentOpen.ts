import { proxy } from "valtio";

export interface SubagentOpenRequest {
  sessionId: string;
  agentId: string;
  ts: number;
}

/**
 * A subagent row outside the chat (the home, the rail) asks for its panel;
 * the session's ChatView takes the request once it's showing that session.
 */
export const agentOpenStore = proxy<{
  subagent: SubagentOpenRequest | null;
}>({
  subagent: null,
});

export function openSubagent(sessionId: string, agentId: string) {
  agentOpenStore.subagent = { sessionId, agentId, ts: Date.now() };
}

/** Longer than an attach takes; an older request was abandoned or failed */
const REQUEST_TTL_MS = 10_000;

/** The pending agent id for this session, cleared so it opens only once */
export function consumeSubagent(sessionId: string): string | null {
  const request = agentOpenStore.subagent;
  if (!request || request.sessionId !== sessionId) return null;
  agentOpenStore.subagent = null;
  return Date.now() - request.ts > REQUEST_TTL_MS ? null : request.agentId;
}
