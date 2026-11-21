/**
 * The hub's side of "taken" (lib/link/protocol.ts): the list each machine
 * must pause when it connects, and what its answer changes. Server only;
 * wired into the link as HubDeps.takenFor and onTakenAck.
 */

import { createHash } from "crypto";
import type Database from "better-sqlite3";
import { getDb, queries, type Session } from "../db";
import type { TakenResult, TakenSession } from "../link/protocol";
import { serverName, type MachineRow } from "../link/store";
import { recordNotification, setDelivered } from "../push/history";
import { sendPush } from "../push/send";
import { serverNameOr } from "../server-name";
import { parseMovedFrom, parseMovedTo } from "../session-move-types";
import { takenRows, takenSessionOf, type BackupRow } from "./store";

/** "taken" for a session the hub itself has, built from its own row */
export function takenFromSession(
  session: Session,
  row: BackupRow | null
): TakenSession {
  const from = parseMovedFrom(session.moved_from);
  const takeId =
    from?.takeId ??
    row?.take_id ??
    createHash("sha256").update(session.id).digest("hex").slice(0, 16);
  return {
    sessionId: session.id,
    takeId,
    at: from?.at ?? Date.now(),
    copyAt: from?.copyAt ?? row?.copied_at ?? from?.at ?? Date.now(),
    hubName: serverNameOr(serverName()),
    claudeSessionId: session.claude_session_id ?? row?.claude_session_id ?? "",
    // Unknown counts as more: the machine keeps what it has
    transcriptBytes: row?.file_bytes ?? 0,
    head: row?.head ?? null,
    tree: row?.snapshot_tree ?? null,
  };
}

/** "taken" for a taken row */
export function takenFromRow(row: BackupRow): TakenSession {
  return {
    sessionId: row.session_id,
    takeId: row.take_id ?? "",
    at: row.taken_at ?? row.copied_at,
    copyAt: row.copied_at,
    hubName: serverNameOr(serverName()),
    claudeSessionId: row.claude_session_id,
    transcriptBytes: row.file_bytes,
    head: row.head,
    tree: row.snapshot_tree,
  };
}

/**
 * Moved back to that machine since ("Bring it back"): it runs there now,
 * so it is not paused. Its row turns current at the machine's next begin
 */
function wentBack(
  row: BackupRow,
  machineId: string,
  db: Database.Database
): boolean {
  const session = queries.getSession(db).get(row.session_id) as
    | Session
    | undefined;
  return (
    !!session?.settled_at &&
    parseMovedTo(session.moved_to)?.machine === machineId
  );
}

/**
 * An orphan goes to every machine, so only while the session it made still
 * runs here: once it has moved on, the machine it went to must not be paused
 */
function stillHere(row: BackupRow, db: Database.Database): boolean {
  const session = takenSessionOf(row.session_id, row.take_id ?? "", db);
  return !!session && !session.settled_at;
}

/** HubDeps.takenFor: everything this machine must pause */
export function takenFor(
  machine: Pick<MachineRow, "id">,
  db: Database.Database = getDb()
): TakenSession[] {
  return takenRows(machine.id, db)
    .filter(
      (row) =>
        row.take_id &&
        !wentBack(row, machine.id, db) &&
        (row.orphan !== 1 || stillHere(row, db))
    )
    .map(takenFromRow);
}

export interface AckDeps {
  db: Database.Database;
  now(): number;
  /** A history entry and a push */
  notify(message: { title: string; body: string; sessionId: string }): void;
}

const liveAck = (): AckDeps => ({
  db: getDb(),
  now: Date.now,
  notify: (message) => {
    const entry = recordNotification({ kind: "fromMachine", ...message });
    if (process.env.AGENTOS_DISABLE_PUSH === "1") return;
    sendPush({ kind: "fromMachine", ...message })
      .then((report) => setDelivered(entry.id, report))
      .catch(() => {});
  },
});

/**
 * HubDeps.onTakenAck: only rows of this machine (or orphans) with the
 * same take id change. "paused" and "already" confirm it; "gone" confirms
 * only the machine's own rows (an orphan may be on another machine);
 * "failed" leaves it to be sent again on the next connect
 */
export function onTakenAck(
  machine: Pick<MachineRow, "id" | "name">,
  results: TakenResult[],
  deps: AckDeps = liveAck()
): void {
  const { db } = deps;
  for (const result of results) {
    const rows = db
      .prepare(
        `SELECT * FROM machine_backups WHERE session_id = ? AND take_id = ?
           AND state = 'taken' AND ((machine_id = ? AND orphan = 0) OR orphan = 1)`
      )
      .all(result.sessionId, result.takeId, machine.id) as BackupRow[];
    for (const row of rows) {
      if (result.state === "failed") continue;
      if (result.state === "gone") {
        if (row.orphan === 1 || row.machine_id !== machine.id) continue;
        if (row.machine_paused_at === null) {
          db.prepare(
            `UPDATE machine_backups SET machine_paused_at = ?
             WHERE machine_id = ? AND session_id = ?`
          ).run(deps.now(), row.machine_id, row.session_id);
        }
        continue;
      }
      const ahead = result.ahead
        ? {
            ...result.ahead,
            ...(result.folder ? { folder: result.folder } : {}),
          }
        : null;
      const first = row.machine_paused_at === null;
      db.prepare(
        `UPDATE machine_backups SET machine_paused_at = COALESCE(machine_paused_at, ?),
           ahead = COALESCE(?, ahead)
         WHERE machine_id = ? AND session_id = ?`
      ).run(
        deps.now(),
        ahead ? JSON.stringify(ahead) : null,
        row.machine_id,
        row.session_id
      );
      if (!first || !ahead || !(ahead.conversation || ahead.code)) continue;
      // The session here learns it too, for its line above the composer
      const session = queries.getSession(db).get(row.session_id) as
        | Session
        | undefined;
      const from = parseMovedFrom(session?.moved_from);
      if (session && from?.takeId === result.takeId) {
        db.prepare(`UPDATE sessions SET moved_from = ? WHERE id = ?`).run(
          JSON.stringify({ ...from, ahead }),
          session.id
        );
      }
      const name = session?.name ?? row.name;
      deps.notify({
        title: `${machine.name} did more on "${name}" after the copy`,
        body: `That work is still on ${machine.name}. It isn't in the session here.`,
        sessionId: row.session_id,
      });
    }
  }
}
