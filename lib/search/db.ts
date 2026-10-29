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

import type Database from "better-sqlite3";

export const SEARCH_SCHEMA_VERSION = 1;

/** $AGENT_OS_HOME/search.db (AGENT_OS_HOME, else ~/.agent-os) */
export function searchDbFile(): string {
  throw new Error("M11 U11.1: searchDbFile not implemented");
}

/**
 * The index, opened once per process (globalThis, like lib/flags: server.ts
 * and the Next bundle load separate copies). `file` overrides the path for
 * tests. Null when it can't be opened; callers then act as if the flag
 * were off.
 */
export function openSearchDb(file?: string): Database.Database | null {
  void file;
  return null;
}

/** Closes and forgets the cached handle (tests) */
export function closeSearchDb(): void {}
