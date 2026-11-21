/**
 * Where the hub keeps copies of a linked machine's sessions (lib/backup).
 * Server only.
 *
 *   $AGENT_OS_HOME/backups/<machineId>/repos/<repoKey>.git        bare, never checked out
 *   $AGENT_OS_HOME/backups/<machineId>/sessions/<sid>/conversation.g<N>.jsonl
 *   $AGENT_OS_HOME/backups/<machineId>/sessions/<sid>/incoming/<backupId>/
 *
 * <machineId> is always the tunnel's. Folders are 0700 and files 0600,
 * opened without following links, under folders AgentOS made. Everything
 * in a copy is the machine's data: nothing here runs it or trusts it.
 */

import { createHash } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { home } from "../link/secrets";
import { normalRemote, type MovedFrom } from "../session-move-types";
import { git } from "../turns-git";
import { BACKUP_SESSION_ID, type BackupManifest } from "./types";

const GiB = 1024 ** 3;

function envBytes(name: string): number | null {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Limits on what one machine may keep here */
export const BACKUP_LIMITS = {
  /** One bundle upload */
  bundle: 2 * GiB,
  /** One session's conversation */
  conversation: 2 * GiB,
  sessions: 2000,
  /** The whole backups/<machineId> folder: repos, incoming and all */
  machine: 20 * GiB,
  /**
   * Refused below this much free space where AgentOS keeps its data.
   * AGENTOS_BACKUP_MIN_FREE_BYTES (the server's own environment) is for
   * tests on a small disk
   */
  minFree: envBytes("AGENTOS_BACKUP_MIN_FREE_BYTES") ?? 5 * GiB,
  /** A JSON body */
  json: 1024 * 1024,
};

const MACHINE_ID = /^m_[0-9a-f]{12}$/;
const REPO_KEY = /^[0-9a-f]{16}$/;
const LONG_MS = 45 * 60_000;

export interface BackupRow {
  machine_id: string;
  session_id: string;
  machine_name: string;
  name: string;
  project_name: string | null;
  claude_session_id: string;
  /** JSON BackupManifest */
  manifest: string;
  repo_key: string | null;
  head: string | null;
  snapshot_commit: string | null;
  snapshot_tree: string | null;
  file_gen: number;
  file_bytes: number;
  has_settings: number;
  copied_at: number;
  last_active_at: number | null;
  state: "current" | "taking" | "taken";
  take_id: string | null;
  taken_at: number | null;
  machine_paused_at: number | null;
  /** JSON { conversation, code, folder? } from its taken-ack */
  ahead: string | null;
  orphan: number;
}

export function parseManifest(row: BackupRow): BackupManifest | null {
  try {
    return JSON.parse(row.manifest) as BackupManifest;
  } catch {
    return null;
  }
}

// --- Folders ---

export const backupsRoot = () => path.join(home(), "backups");

function checkMachine(machineId: string): string {
  if (!MACHINE_ID.test(machineId)) throw new Error("Bad machine id");
  return machineId;
}

function checkSession(sessionId: string): string {
  if (!BACKUP_SESSION_ID.test(sessionId)) throw new Error("Bad session id");
  return sessionId;
}

export const machineDir = (machineId: string) =>
  path.join(backupsRoot(), checkMachine(machineId));

export const sessionDir = (machineId: string, sessionId: string) =>
  path.join(machineDir(machineId), "sessions", checkSession(sessionId));

export const incomingDir = (
  machineId: string,
  sessionId: string,
  backupId: string
) => path.join(sessionDir(machineId, sessionId), "incoming", backupId);

export const conversationFile = (
  machineId: string,
  sessionId: string,
  gen: number
) => path.join(sessionDir(machineId, sessionId), `conversation.g${gen}.jsonl`);

export function repoDir(machineId: string, repoKey: string): string {
  if (!REPO_KEY.test(repoKey)) throw new Error("Bad repository key");
  return path.join(machineDir(machineId), "repos", `${repoKey}.git`);
}

/**
 * Makes each folder from backups/ down to `dir` (0700), refusing any that
 * is a link: a folder AgentOS didn't make is never written into
 */
export async function ensureDir(dir: string): Promise<void> {
  const rel = path.relative(home(), dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Outside the copies folder");
  }
  let at = home();
  await fsp.mkdir(at, { recursive: true, mode: 0o700 });
  for (const part of rel.split(path.sep)) {
    at = path.join(at, part);
    try {
      const st = await fsp.lstat(at);
      if (!st.isDirectory()) throw new Error("Not a folder AgentOS made");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fsp.mkdir(at, { mode: 0o700 });
    }
  }
}

/** Opens a file to write without following a link (0600) */
export function openForWrite(
  file: string,
  how: "append" | "create"
): Promise<fsp.FileHandle> {
  const c = fs.constants;
  const flags =
    c.O_WRONLY |
    c.O_CREAT |
    c.O_NOFOLLOW |
    (how === "append" ? c.O_APPEND : c.O_TRUNC);
  return fsp.open(file, flags, 0o600);
}

/** Bytes under a folder, links not followed */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderBytes(at);
    else if (entry.isFile()) {
      total += (await fsp.lstat(at).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}

/** Free bytes where AgentOS keeps its data; Infinity when unknown */
export async function freeBytes(): Promise<number> {
  try {
    await fsp.mkdir(home(), { recursive: true });
    const st = await fsp.statfs(home());
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return Infinity;
  }
}

/**
 * The key a copied repository is kept under: its normalised remote, else
 * its name and first commit. 16 hex, so it is always a safe file name
 */
export function repoKeyOf(repo: {
  name: string;
  remote: string | null;
  first: string;
}): string {
  const source = repo.remote
    ? normalRemote(repo.remote)
    : `${repo.name}:${repo.first}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

/** A bare repository that never runs hooks or packs itself */
export async function ensureBareRepo(dir: string): Promise<void> {
  if (fs.existsSync(path.join(dir, "HEAD"))) return;
  await ensureDir(dir);
  await git(["init", "--bare", "--quiet"], { cwd: dir });
  await git(["config", "core.hooksPath", "/dev/null"], { cwd: dir });
  await git(["config", "gc.auto", "0"], { cwd: dir });
  await git(["config", "receive.fsckObjects", "true"], { cwd: dir });
}

/** Daily: packs and prunes each copied repository */
export async function gcRepos(): Promise<void> {
  let machines: string[];
  try {
    machines = await fsp.readdir(backupsRoot());
  } catch {
    return;
  }
  for (const machine of machines) {
    if (!MACHINE_ID.test(machine)) continue;
    let repos: string[] = [];
    try {
      repos = await fsp.readdir(path.join(backupsRoot(), machine, "repos"));
    } catch {
      continue;
    }
    for (const repo of repos) {
      if (!/^[0-9a-f]{16}\.git$/.test(repo)) continue;
      await git(["gc", "--quiet", "--prune=now"], {
        cwd: path.join(backupsRoot(), machine, "repos", repo),
        timeoutMs: LONG_MS,
      }).catch((error) => console.error("[backup] gc:", error));
    }
  }
}

// --- Rows ---

export function backupRow(
  machineId: string,
  sessionId: string,
  db: Database.Database = getDb()
): BackupRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM machine_backups WHERE machine_id = ? AND session_id = ?`
      )
      .get(machineId, sessionId) as BackupRow | undefined) ?? null
  );
}

export function backupRows(
  machineId: string,
  db: Database.Database = getDb()
): BackupRow[] {
  return db
    .prepare(
      `SELECT * FROM machine_backups WHERE machine_id = ? AND orphan = 0
       ORDER BY copied_at DESC`
    )
    .all(machineId) as BackupRow[];
}

/**
 * Everything a machine must pause on connect: its own taken rows, and
 * every orphan still unconfirmed (its machine was removed and linked
 * again under a new key; session ids are UUIDs, so any machine may hold it)
 */
export function takenRows(
  machineId: string,
  db: Database.Database = getDb()
): BackupRow[] {
  return db
    .prepare(
      `SELECT * FROM machine_backups WHERE state = 'taken' AND
         ((machine_id = ? AND orphan = 0) OR
          (orphan = 1 AND machine_paused_at IS NULL))`
    )
    .all(machineId) as BackupRow[];
}

/** Taken, and the machine hasn't said it paused its own */
export const unconfirmed = (row: BackupRow) =>
  row.state === "taken" && row.machine_paused_at === null;

/** A copy's files: its conversation and incoming uploads (repos are shared) */
async function dropSessionFiles(machineId: string, sessionId: string) {
  await fsp.rm(sessionDir(machineId, sessionId), {
    recursive: true,
    force: true,
  });
}

/** Removes a copy's refs from its repository (the objects go at the next gc) */
async function dropSessionRefs(row: BackupRow): Promise<void> {
  if (!row.repo_key) return;
  const repo = repoDir(row.machine_id, row.repo_key);
  if (!fs.existsSync(repo)) return;
  const refs = await git(
    ["for-each-ref", "--format=%(refname)", `refs/agent-os/${row.session_id}/`],
    { cwd: repo }
  ).catch(() => "");
  for (const ref of refs.split("\n").filter(Boolean)) {
    await git(["update-ref", "-d", ref], { cwd: repo }).catch(() => {});
  }
}

/**
 * Deletes copies. A taken row the machine hasn't confirmed stays: it is
 * how the machine is told to pause. So does one being continued here
 * right now: the take-over reads its files. Returns how many went
 */
export async function deleteCopies(
  rows: BackupRow[],
  db: Database.Database = getDb()
): Promise<number> {
  let removed = 0;
  for (const row of rows) {
    if (unconfirmed(row) || row.state === "taking") continue;
    const { changes } = db
      .prepare(
        `DELETE FROM machine_backups WHERE machine_id = ? AND session_id = ?
           AND state != 'taking'
           AND NOT (state = 'taken' AND machine_paused_at IS NULL)`
      )
      .run(row.machine_id, row.session_id);
    if (changes !== 1) continue;
    removed++;
    await dropSessionRefs(row).catch(() => {});
    await dropSessionFiles(row.machine_id, row.session_id).catch(() => {});
  }
  return removed;
}

/**
 * A machine was removed: its copies go, all but the taken rows it never
 * confirmed, which stay as orphans for whichever machine holds them
 */
export async function forgetMachine(
  machineId: string,
  db: Database.Database = getDb()
): Promise<void> {
  // A take-over under way may still finish: its row must then be there to
  // turn taken (lib/backup/takeover.ts drops it if the take-over fails)
  db.prepare(
    `UPDATE machine_backups SET orphan = 1
     WHERE machine_id = ? AND ((state = 'taken' AND machine_paused_at IS NULL)
       OR state = 'taking')`
  ).run(machineId);
  db.prepare(
    `DELETE FROM machine_backups WHERE machine_id = ? AND orphan = 0`
  ).run(machineId);
  db.prepare(`DELETE FROM backup_departures WHERE machine_id = ?`).run(
    machineId
  );
  if (MACHINE_ID.test(machineId)) {
    await fsp.rm(machineDir(machineId), { recursive: true, force: true });
  }
}

/** The session moved away from that machine: no copy of it from there now */
export function departed(
  machineId: string,
  sessionId: string,
  db: Database.Database = getDb()
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM backup_departures WHERE machine_id = ? AND session_id = ?`
    )
    .get(machineId, sessionId);
}

/**
 * A move finished: copies from the machine it left are refused from now on,
 * and the machine it went to may copy it again. null is this server
 */
export function noteMove(
  sessionId: string,
  from: string | null,
  to: string | null,
  db: Database.Database = getDb(),
  now: number = Date.now()
): void {
  db.transaction(() => {
    if (to) {
      db.prepare(
        `DELETE FROM backup_departures WHERE machine_id = ? AND session_id = ?`
      ).run(to, sessionId);
    }
    if (from) {
      db.prepare(
        `INSERT OR REPLACE INTO backup_departures (machine_id, session_id, at)
         VALUES (?, ?, ?)`
      ).run(from, sessionId, now);
    }
  })();
}

/** Copies of a session under other machines (not taken): one copy per session */
export async function dropOtherCopies(
  sessionId: string,
  keepMachine: string | null,
  db: Database.Database = getDb()
): Promise<number> {
  const rows = (
    db
      .prepare(
        `SELECT * FROM machine_backups WHERE session_id = ? AND state != 'taken'`
      )
      .all(sessionId) as BackupRow[]
  ).filter((r) => r.machine_id !== keepMachine);
  return deleteCopies(rows, db);
}

/** The hub session continued from this copy, by its take id */
export function takenSessionOf(
  sessionId: string,
  takeId: string,
  db: Database.Database = getDb()
): { id: string; settled_at: number | null; moved_from: string | null } | null {
  const session = db
    .prepare(`SELECT id, settled_at, moved_from FROM sessions WHERE id = ?`)
    .get(sessionId) as
    | { id: string; settled_at: number | null; moved_from: string | null }
    | undefined;
  if (!session?.moved_from) return null;
  try {
    const from = JSON.parse(session.moved_from) as MovedFrom;
    return from.takeId === takeId ? session : null;
  } catch {
    return null;
  }
}

/** Settings, Machines: how much one machine keeps here */
export function copyTotals(
  machineId: string,
  db: Database.Database = getDb()
): { copies: number; newestCopyAt: number | null; unconfirmed: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS copies, MAX(copied_at) AS newest,
         SUM(CASE WHEN state = 'taken' AND machine_paused_at IS NULL THEN 1 ELSE 0 END) AS unconfirmed
       FROM machine_backups WHERE machine_id = ? AND orphan = 0`
    )
    .get(machineId) as {
    copies: number;
    newest: number | null;
    unconfirmed: number | null;
  };
  return {
    copies: row.copies,
    newestCopyAt: row.newest,
    unconfirmed: row.unconfirmed ?? 0,
  };
}

export { LONG_MS as BACKUP_GIT_MS };
