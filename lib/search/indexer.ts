/**
 * M11: indexes the transcripts of Agent-OS Claude sessions into search.db.
 * Newest sessions first, incrementally from search_progress offsets, in
 * 256KB chunks with setImmediate yields and a CPU budget per tick. Only
 * user/assistant text (entryItems in lib/claude-transcript.ts, so item ids
 * match the chat's); tool calls and output are skipped. A file now shorter
 * than its saved offset is re-indexed from 0. Owned by U11.1.
 */

import type Database from "better-sqlite3";

export const INDEX_CHUNK_BYTES = 256 * 1024;
/** CPU per tick before yielding to the next one */
export const INDEX_TICK_BUDGET_MS = 50;
export const INDEX_INTERVAL_MS = 15_000;

export interface IndexFileResult {
  /** Messages added */
  added: number;
  /** The new saved offset */
  offset: number;
  /** The file was shorter than its offset and was re-indexed from 0 */
  reset: boolean;
  /** More remains past `offset` (budget or chunk cap reached) */
  more: boolean;
}

/**
 * Indexes `file` (a Claude transcript of `sessionId`, cwd `cwd`) from its
 * saved offset, at most `maxBytes`, into `db`. Pure enough for unit tests.
 */
export async function indexFile(
  db: Database.Database,
  sessionId: string,
  file: string,
  cwd: string,
  maxBytes: number = INDEX_CHUNK_BYTES
): Promise<IndexFileResult> {
  void db;
  void sessionId;
  void file;
  void cwd;
  void maxBytes;
  throw new Error("M11 U11.1: indexFile not implemented");
}

/** Drops a session's messages and progress (session deleted) */
export function forgetSession(db: Database.Database, sessionId: string): void {
  void db;
  void sessionId;
}

/** One pass over the sessions within `budgetMs`; true if work remains */
export async function indexTick(
  budgetMs: number = INDEX_TICK_BUDGET_MS
): Promise<boolean> {
  void budgetMs;
  return false;
}

/**
 * Started once from lib/tickers.ts. Each interval checks flag
 * `searchIndex` (and AGENTOS_DISABLE_TICKERS through startTickers).
 */
export function startSearchIndexer(): void {}
