/**
 * A paused session (M4: handed off to another agent) in every list: its own
 * state word, below the live ones, "Handed off to Codex" under its name.
 * Pure, so the lists and the tests share it.
 */

import type { Session } from "./db/types";
import {
  fromSessionStatus,
  sessionState as limitAwareState,
  type AgentState,
} from "./agent-state";
import { isPaused } from "./handoff-types";
import { isEnded, isSettled } from "./settle-types";

/** paused_at, and settled_at where the caller has it (M8) */
type EndedFields = Pick<Session, "paused_at"> &
  Partial<Pick<Session, "settled_at">>;

/**
 * A session's state: paused or settled (M8) whatever its tmux says, else
 * limited while it is listed as limited (M6), else from its status
 */
export function sessionState(
  session:
    | (EndedFields & Parameters<typeof limitAwareState>[0])
    | null
    | undefined,
  status: string | null | undefined,
  /** What a missing status means at that call site */
  fallback = "idle"
): AgentState {
  if (isPaused(session)) return "paused";
  if (isSettled(session)) return "settled";
  return session
    ? limitAwareState(session, status ?? fallback)
    : fromSessionStatus(status ?? fallback);
}

/** The session it was handed to, while it is still listed */
export function successorOf<S extends Pick<Session, "id">>(
  session: Pick<Session, "handoff_to_session_id">,
  sessions: readonly S[]
): S | undefined {
  const id = session.handoff_to_session_id;
  return id ? sessions.find((s) => s.id === id) : undefined;
}

/**
 * "Handed off to Codex", by the successor's agent; plain "Handed off" when
 * it is gone from the list, "Paused" when it was paused without a handoff
 */
export function handedOffLine(
  session: Pick<Session, "handoff_to_session_id">,
  sessions: readonly { id: string; agent_type?: string | null }[],
  agentName: (agentType: string | null | undefined) => string
): string {
  if (!session.handoff_to_session_id) return "Paused";
  const successor = successorOf(session, sessions);
  return successor
    ? `Handed off to ${agentName(successor.agent_type)}`
    : "Handed off";
}

/**
 * Live sessions first, then paused ones, then settled ones (M8), each
 * keeping its order
 */
export function pausedLast<S extends EndedFields>(sessions: readonly S[]): S[] {
  return [
    ...sessions.filter((s) => !isEnded(s)),
    ...sessions.filter((s) => isPaused(s)),
    ...sessions.filter((s) => !isPaused(s) && isSettled(s)),
  ];
}

/**
 * Only the sessions that can need you or work: not the paused or settled
 * ones (their tmux ended)
 */
export function withoutPaused<S extends EndedFields>(
  sessions: readonly S[]
): S[] {
  return sessions.filter((s) => !isEnded(s));
}
