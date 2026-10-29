/**
 * M11: the transcript index, in its own file $AGENT_OS_HOME/search.db (not
 * the main DB, which every deploy backs up). WAL, its own schema version in
 * `user_version`; a file with another version, or a corrupt one, is deleted
 * and rebuilt. Tables:
 *   search_messages  FTS5 (session_id UNINDEXED, role UNINDEXED,
 *                    ts UNINDEXED, item_id UNINDEXED, text)
 *   search_progress  (file TEXT PRIMARY KEY, offset INTEGER, session_id TEXT)
 * Owned by U11.1.
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

export const SEARCH_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS search_messages USING fts5(
  session_id UNINDEXED,
  role UNINDEXED,
  ts UNINDEXED,
  item_id UNINDEXED,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS search_progress (
  file TEXT PRIMARY KEY,
  offset INTEGER NOT NULL DEFAULT 0,
  session_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_progress_session
  ON search_progress(session_id);
`;

// On globalThis: server.ts (the indexer) and the Next bundle (the route)
// load separate copies of this module
const shared = globalThis as unknown as {
  __agentosSearchDb?: { db: Database.Database; file: string } | null;
  __agentosSearchDbLogged?: boolean;
};

/** $AGENT_OS_HOME/search.db (AGENT_OS_HOME, else ~/.agent-os) */
export function searchDbFile(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "search.db");
}

function removeFiles(file: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(file + suffix, { force: true });
    } catch {
      // Gone already
    }
  }
}

/** Opens `file` and checks it is ours at this version; throws otherwise */
function openChecked(file: string): Database.Database {
  const db = new Database(file);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    const version = db.pragma("user_version", { simple: true }) as number;
    if (version !== 0 && version !== SEARCH_SCHEMA_VERSION) {
      throw new Error(`schema version ${version}`);
    }
    db.exec(SCHEMA);
    if (version === 0) db.pragma(`user_version = ${SEARCH_SCHEMA_VERSION}`);
    // A corrupt file can open fine and fail only on reads
    db.prepare("SELECT count(*) FROM search_progress").get();
    db.prepare("SELECT rowid FROM search_messages LIMIT 1").get();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * The index, opened once per process (globalThis, like lib/flags: server.ts
 * and the Next bundle load separate copies). `file` overrides the path for
 * tests. Null when it can't be opened; callers then act as if the flag
 * were off.
 */
export function openSearchDb(file?: string): Database.Database | null {
  const target = file || searchDbFile();
  const cached = shared.__agentosSearchDb;
  if (cached && cached.file === target && cached.db.open) return cached.db;
  if (cached) closeSearchDb();

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let db: Database.Database;
    try {
      db = openChecked(target);
    } catch (error) {
      // Another version or a corrupt file: the index is a cache, rebuild it
      console.warn(
        "[search] rebuilding index:",
        error instanceof Error ? error.message : error
      );
      removeFiles(target);
      db = openChecked(target);
    }
    shared.__agentosSearchDb = { db, file: target };
    return db;
  } catch (error) {
    if (!shared.__agentosSearchDbLogged) {
      shared.__agentosSearchDbLogged = true;
      console.error("[search] can't open the index:", error);
    }
    return null;
  }
}

/** Closes and forgets the cached handle (tests) */
export function closeSearchDb(): void {
  const cached = shared.__agentosSearchDb;
  shared.__agentosSearchDb = null;
  if (cached?.db.open) {
    try {
      cached.db.close();
    } catch {
      // Closing is best effort
    }
  }
}
