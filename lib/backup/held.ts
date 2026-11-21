/**
 * On a machine: a session the hub continued from its copy stays paused
 * here until the hub says it let go of it (GET /api/link/inbox/taken/<id>,
 * {held: false}: deleted there). Only then may this copy run again.
 * Server only.
 */

import { getDb, type Session } from "../db";
import { isMachineMode, uploadToHub } from "../link/machine";
import { parseMovedTo } from "../session-move-types";
import { BACKUP_SESSION_ID } from "./types";
import { heldSessions } from "./hold";

/** Asks the hub; null when it can't be asked (offline, copies off) */
export async function hubHolds(sessionId: string): Promise<boolean | null> {
  if (!isMachineMode() || !BACKUP_SESSION_ID.test(sessionId)) return null;
  try {
    // A fixed question about one session: nothing a caller chose is sent
    const answer = await uploadToHub({
      method: "GET",
      path: `/api/link/inbox/taken/${sessionId}`,
    });
    if (answer.status !== 200) return null;
    const body = JSON.parse(answer.body.toString("utf8")) as { held?: unknown };
    return typeof body.held === "boolean" ? body.held : null;
  } catch {
    return null;
  }
}

/**
 * Before Resume (unsettle, resume-paused) of a continued copy: clears its
 * moved_to once the hub has let go. Otherwise the refusal to show
 */
export async function releaseTakeover(
  session: Session
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const went = parseMovedTo(session.moved_to);
  if (!went?.takeover) return { ok: true };
  const refused = {
    ok: false as const,
    status: 409,
    error: `It continued on ${went.name}. Open it there, or bring it back.`,
  };
  if ((await hubHolds(session.id)) !== false) return refused;
  const { changes } = getDb()
    .prepare(
      `UPDATE sessions SET moved_to = NULL, updated_at = datetime('now')
       WHERE id = ? AND moved_to = ?`
    )
    .run(session.id, session.moved_to);
  if (changes !== 1) return refused;
  heldSessions().delete(session.id);
  return { ok: true };
}
