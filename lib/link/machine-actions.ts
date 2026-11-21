/**
 * What sessions on a linked machine did on this server (migration 41):
 * started a session, sent a message, answered, interrupted, stopped, or
 * were refused. Settings, Machines shows it per machine. The machine's
 * name is always this server's own row, never something the machine said.
 * Kept 30 days, and at most 500 rows per machine.
 */

import type Database from "better-sqlite3";
import { getDb } from "../db";

export type MachineActionKind =
  | "start"
  | "message"
  | "answer"
  | "interrupt"
  | "stop"
  | "refused";

export interface MachineAction {
  id: number;
  machine_id: string;
  machine_name: string;
  action: MachineActionKind;
  target_session_id: string | null;
  target_name: string | null;
  /** Set when it went on to another machine */
  target_machine_id: string | null;
  /** The first 200 characters of the task or message, or the refusal code */
  detail: string | null;
  allowed: number;
  at: number;
}

export type NewMachineAction = Omit<MachineAction, "id" | "at"> & {
  at?: number;
};

const KEEP_MS = 30 * 86400_000;
const KEEP_ROWS = 500;

/** Best effort: the record never fails the request it describes */
export function recordMachineAction(
  row: NewMachineAction,
  db: Database.Database = getDb()
): void {
  try {
    const at = row.at ?? Date.now();
    db.prepare(
      `INSERT INTO machine_actions
         (machine_id, machine_name, action, target_session_id, target_name,
          target_machine_id, detail, allowed, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.machine_id,
      row.machine_name,
      row.action,
      row.target_session_id,
      row.target_name?.slice(0, 200) ?? null,
      row.target_machine_id,
      row.detail?.slice(0, 200) ?? null,
      row.allowed ? 1 : 0,
      at
    );
    db.prepare(`DELETE FROM machine_actions WHERE at < ?`).run(at - KEEP_MS);
    db.prepare(
      `DELETE FROM machine_actions WHERE machine_id = ? AND id NOT IN (
         SELECT id FROM machine_actions WHERE machine_id = ?
         ORDER BY at DESC, id DESC LIMIT ?)`
    ).run(row.machine_id, row.machine_id, KEEP_ROWS);
  } catch (error) {
    console.error("[machine-actions] record failed:", error);
  }
}

/** Newest first */
export function listMachineActions(
  machineId: string,
  limit = 50,
  db: Database.Database = getDb()
): MachineAction[] {
  return db
    .prepare(
      `SELECT * FROM machine_actions WHERE machine_id = ?
       ORDER BY at DESC, id DESC LIMIT ?`
    )
    .all(machineId, Math.max(1, Math.min(KEEP_ROWS, limit))) as MachineAction[];
}

/** When the machine was last refused for this reason, for the hourly entry */
export function lastRefused(
  machineId: string,
  detail: string,
  db: Database.Database = getDb()
): number | null {
  const row = db
    .prepare(
      `SELECT MAX(at) AS at FROM machine_actions
       WHERE machine_id = ? AND action = 'refused' AND detail = ?`
    )
    .get(machineId, detail) as { at: number | null } | undefined;
  return row?.at ?? null;
}
