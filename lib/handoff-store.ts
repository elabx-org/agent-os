/**
 * The SQL for M4 (migration 28): a session's model and effort, its handoff
 * links and its paused mark. Every function takes the connection, so the
 * tests run them on a temp DB.
 */

import type Database from "better-sqlite3";

/** The model (and the effort, when given) for the next turn or launch */
export function setModelEffort(
  db: Database.Database,
  sessionId: string,
  model: string,
  effort?: string | null
): void {
  if (effort === undefined) {
    db.prepare(
      `UPDATE sessions SET model = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(model, sessionId);
    return;
  }
  db.prepare(
    `UPDATE sessions SET model = ?, effort = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(model, effort, sessionId);
}

/** The session a new one was handed off from */
export function setHandoffFrom(
  db: Database.Database,
  sessionId: string,
  fromSessionId: string
): void {
  db.prepare(
    `UPDATE sessions SET handoff_from_session_id = ? WHERE id = ?`
  ).run(fromSessionId, sessionId);
}

/**
 * Marks the source handed off: paused since `at`, pointing at its
 * successor. False when it was already paused (or is gone)
 */
export function markHandedOff(
  db: Database.Database,
  sessionId: string,
  toSessionId: string,
  at: number
): boolean {
  const { changes } = db
    .prepare(
      `UPDATE sessions SET paused_at = ?, handoff_to_session_id = ?,
         updated_at = datetime('now')
       WHERE id = ? AND paused_at IS NULL`
    )
    .run(at, toSessionId, sessionId);
  return changes === 1;
}

/**
 * Clears the paused mark for a resume. The link to the successor stays, as
 * history. False when it wasn't paused
 */
export function clearPaused(db: Database.Database, sessionId: string): boolean {
  const { changes } = db
    .prepare(
      `UPDATE sessions SET paused_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND paused_at IS NOT NULL`
    )
    .run(sessionId);
  return changes === 1;
}

/** Puts the paused mark back (a resume whose launch failed) */
export function restorePaused(
  db: Database.Database,
  sessionId: string,
  at: number
): void {
  db.prepare(
    `UPDATE sessions SET paused_at = ? WHERE id = ? AND paused_at IS NULL`
  ).run(at, sessionId);
}
