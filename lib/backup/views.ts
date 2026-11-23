/**
 * The copies a machine keeps on the hub, as Settings and the copies sheet
 * show them (app/api/machines). Server only.
 */

import { getDb, queries, type Session } from "../db";
import { machineCaps } from "../link/store";
import { CAP_TAKE } from "../link/protocol";
import { peerOfflineFor, peerOnline, peerRow } from "./peer";
import {
  BACKUP_LIMITS,
  backupRows,
  copyTotals,
  folderBytes,
  machineDir,
  unconfirmed,
} from "./store";
import { offlineNeeded, whyNotTake } from "./takeover";
import type { BackupView } from "./types";

const shared = globalThis as typeof globalThis & {
  __agentosCopyBytes?: Map<string, { at: number; bytes: number }>;
};
/** Settings polls every 2 s: the folder is measured at most every 30 s */
const BYTES_MS = 30_000;

/** How much a machine's copies take here, measured now and then */
export async function copyBytes(machineId: string): Promise<number> {
  const cache = (shared.__agentosCopyBytes ??= new Map());
  const hit = cache.get(machineId);
  if (hit && Date.now() - hit.at < BYTES_MS) return hit.bytes;
  const bytes = await folderBytes(machineDir(machineId)).catch(() => 0);
  cache.set(machineId, { at: Date.now(), bytes });
  return bytes;
}

/** GET /api/machines: what each machine's row says about its copies */
export async function copySummary(machineId: string) {
  const totals = copyTotals(machineId);
  const machine = peerRow(machineId);
  const bytes = await copyBytes(machineId);
  return {
    backup: machine?.backup === 1,
    copies: totals.copies,
    newestCopyAt: totals.newestCopyAt,
    copyBytes: bytes,
    copiesFull: bytes >= BACKUP_LIMITS.machine,
    unconfirmed: totals.unconfirmed,
    canTakeOver: machine ? machineCaps(machine).includes(CAP_TAKE) : false,
  };
}

/** GET /api/machines/[id]/backups */
export async function copyViews(machineId: string): Promise<{
  copies: BackupView[];
  bytes: number;
  unconfirmed: number;
}> {
  const db = getDb();
  const machine = peerRow(machineId);
  const online = peerOnline(machineId);
  const offlineMs = peerOfflineFor(machineId);
  const rows = machine ? backupRows(machineId, db) : [];
  const copies = rows.map((row): BackupView => {
    const hubSession =
      (queries.getSession(db).get(row.session_id) as Session | undefined) ??
      null;
    const whyNot = whyNotTake({
      machine,
      online,
      offlineMs,
      row,
      hubSession,
      settingsOk: null,
      offlineNeeded: offlineNeeded(),
    });
    return {
      sessionId: row.session_id,
      name: row.name,
      projectName: row.project_name,
      copiedAt: row.copied_at,
      lastActiveAt: row.last_active_at ?? row.copied_at,
      state: row.state,
      canContinue: whyNot === null,
      ...(whyNot ? { whyNot } : {}),
      hasSettings: row.has_settings === 1,
      unconfirmed: unconfirmed(row),
    };
  });
  return {
    copies,
    bytes: await copyBytes(machineId),
    unconfirmed: rows.filter(unconfirmed).length,
  };
}
