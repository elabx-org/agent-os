/**
 * Agent turns: the session_turns table (migration 26), turn boundaries from
 * the Claude hook's journal and, for Codex/Gemini, the dispatcher and the
 * running->idle edge; and undo, restricted to files the agent touched.
 */

import type { Session } from "./db";
import type { Turn, TurnDetail, UndoResult } from "./turn-types";

// M2 contract: signatures only; U2.2 implements them

/**
 * The session's running->idle edge (lib/tickers.ts subscribes it to
 * lib/session-watch.ts): Codex/Gemini take their post snapshot; Claude's
 * turns are ingested from the hook's journal
 */
export async function onIdleEdge(_session: Session): Promise<void> {}

/**
 * Before the dispatcher types a message into a Codex/Gemini session: the
 * turn's pre snapshot. Claude's comes from its UserPromptSubmit hook
 */
export async function beforeAgentSend(
  _session: Session,
  _text: string
): Promise<void> {}

/** Newest last; empty when snapshots are off for the session */
export async function listTurns(_session: Session): Promise<Turn[]> {
  return [];
}

export async function turnDetail(
  _session: Session,
  _turnNo: number
): Promise<TurnDetail | null> {
  return null;
}

/**
 * Restores each path's pre content where the working file still equals
 * post (else kept), then stores the undo notice (lib/queue/store.ts
 * setUndoNotice). The caller checks requireUser and that the session is idle
 */
export async function undoTurn(
  _session: Session,
  _turnNo: number,
  _paths: string[]
): Promise<UndoResult> {
  throw new Error("Not implemented");
}

/** Deletes the session's refs/agent-os/<id>/* and turn rows (session delete) */
export async function pruneSessionTurns(_session: Session): Promise<void> {}
