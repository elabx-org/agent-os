/**
 * M11: indexes the transcripts of Agent-OS Claude sessions into search.db.
 * Newest sessions first, incrementally from search_progress offsets, in
 * 256KB chunks with setImmediate yields and a CPU budget per tick. Only
 * user/assistant text (entryItems in lib/claude-transcript.ts, so item ids
 * match the chat's); tool calls and output are skipped. A file now shorter
 * than its saved offset is re-indexed from 0. Owned by U11.1.
 */

import fs from "fs";
import { performance } from "perf_hooks";
import type Database from "better-sqlite3";
import { entryItems } from "../claude-transcript";
import { getDb, queries, type Session } from "../db";
import { getFlags, tickersDisabled } from "../flags";
import { locateTranscript } from "../transcript-locate";
import { openSearchDb } from "./db";

export const INDEX_CHUNK_BYTES = 256 * 1024;
/** CPU per tick before yielding to the next one */
export const INDEX_TICK_BUDGET_MS = 50;
export const INDEX_INTERVAL_MS = 15_000;
/** The next tick when the last one ran out of budget */
const INDEX_AGAIN_MS = 1000;
/** How long a located transcript path is trusted (locating asks tmux) */
const LOCATE_TTL_MS = 60_000;

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

interface IndexedMessage {
  role: "user" | "assistant";
  ts: string;
  itemId: string;
  text: string;
}

/** The user/assistant messages of one transcript line ([] for anything else) */
export function lineMessages(line: string, cwd: string): IndexedMessage[] {
  if (!line.trim()) return [];
  let entry: any;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  if (!entry || typeof entry !== "object") return [];
  let items;
  try {
    items = entryItems(entry, cwd);
  } catch {
    return [];
  }
  const out: IndexedMessage[] = [];
  for (const item of items) {
    if (item.kind !== "user" && item.kind !== "assistant") continue;
    if (!item.id || !item.text?.trim()) continue;
    out.push({
      role: item.kind,
      ts: item.ts || entry.timestamp || "",
      itemId: item.id,
      text: item.text,
    });
  }
  return out;
}

/** Reads `length` bytes at `position`; fewer at the end of the file */
function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buffer, read, length - read, position + read);
    if (n === 0) break;
    read += n;
  }
  return buffer.subarray(0, read);
}

function savedProgress(
  db: Database.Database,
  file: string
): { offset: number; session_id: string } | undefined {
  return db
    .prepare("SELECT offset, session_id FROM search_progress WHERE file = ?")
    .get(file) as { offset: number; session_id: string } | undefined;
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
  const size = fs.statSync(file).size;
  let offset = savedProgress(db, file)?.offset ?? 0;
  let reset = false;

  if (size < offset) {
    // Rewritten shorter: the rows can't be told apart by file, so the
    // session's messages go and every file of it starts again from 0
    reset = true;
    offset = 0;
    db.transaction(() => {
      db.prepare("DELETE FROM search_messages WHERE session_id = ?").run(
        sessionId
      );
      db.prepare(
        "UPDATE search_progress SET offset = 0 WHERE session_id = ?"
      ).run(sessionId);
    })();
  }

  if (size === offset) {
    if (reset) saveOffset(db, file, sessionId, 0);
    return { added: 0, offset, reset, more: false };
  }

  // Whole lines only; a line longer than the chunk is read on until its end
  const fd = fs.openSync(file, "r");
  let consumed: Buffer | null = null;
  try {
    const step = Math.max(1, maxBytes);
    let buffer = readAt(fd, offset, Math.min(step, size - offset));
    let end = buffer.lastIndexOf(0x0a);
    while (end < 0 && offset + buffer.length < size) {
      const more = readAt(
        fd,
        offset + buffer.length,
        Math.min(step, size - offset - buffer.length)
      );
      if (!more.length) break;
      const from = buffer.length;
      buffer = Buffer.concat([buffer, more]);
      const at = more.indexOf(0x0a);
      end = at < 0 ? -1 : from + at;
    }
    if (end >= 0) consumed = buffer.subarray(0, end + 1);
  } finally {
    fs.closeSync(fd);
  }

  if (!consumed) {
    // Only a partial last line: wait for Claude to finish writing it
    if (reset) saveOffset(db, file, sessionId, 0);
    return { added: 0, offset, reset, more: false };
  }

  // A newline byte never sits inside a UTF-8 sequence, so this cut is safe
  const messages: IndexedMessage[] = [];
  for (const line of consumed.toString("utf8").split("\n")) {
    messages.push(...lineMessages(line, cwd));
  }
  const next = offset + consumed.length;

  const insert = db.prepare(
    "INSERT INTO search_messages (session_id, role, ts, item_id, text) VALUES (?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    for (const m of messages) {
      insert.run(sessionId, m.role, m.ts, m.itemId, m.text);
    }
    saveOffset(db, file, sessionId, next);
  })();

  return { added: messages.length, offset: next, reset, more: next < size };
}

function saveOffset(
  db: Database.Database,
  file: string,
  sessionId: string,
  offset: number
): void {
  db.prepare(
    `INSERT INTO search_progress (file, offset, session_id) VALUES (?, ?, ?)
     ON CONFLICT(file) DO UPDATE SET offset = excluded.offset,
       session_id = excluded.session_id`
  ).run(file, offset, sessionId);
}

/** Drops a session's messages and progress (session deleted) */
export function forgetSession(db: Database.Database, sessionId: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM search_messages WHERE session_id = ?").run(
      sessionId
    );
    db.prepare("DELETE FROM search_progress WHERE session_id = ?").run(
      sessionId
    );
  })();
}

// On globalThis like the DB handle: one indexer per process
const shared = globalThis as unknown as {
  __agentosSearchIndexer?: {
    started: boolean;
    located: Map<string, { file: string | null; cwd: string; at: number }>;
  };
};

function indexerState() {
  shared.__agentosSearchIndexer ??= { started: false, located: new Map() };
  return shared.__agentosSearchIndexer;
}

async function located(
  session: Session
): Promise<{ file: string | null; cwd: string } | null> {
  const cache = indexerState().located;
  const hit = cache.get(session.id);
  if (hit && Date.now() - hit.at < LOCATE_TTL_MS) return hit;
  const found = await locateTranscript(session);
  if (!found) {
    cache.delete(session.id);
    return null;
  }
  const entry = { file: found.file, cwd: found.cwd, at: Date.now() };
  cache.set(session.id, entry);
  return entry;
}

const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));

/** One pass over the sessions within `budgetMs`; true if work remains */
export async function indexTick(
  budgetMs: number = INDEX_TICK_BUDGET_MS
): Promise<boolean> {
  const db = openSearchDb();
  if (!db) return false;

  const all = queries.getAllSessions(getDb()).all() as Session[];
  const sessions = all
    .filter((s) => (s.agent_type || "claude") === "claude")
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

  // Sessions deleted from the main DB
  const live = new Set(all.map((s) => s.id));
  const indexed = db
    .prepare("SELECT DISTINCT session_id FROM search_progress")
    .all() as { session_id: string }[];
  for (const { session_id } of indexed) {
    if (!live.has(session_id)) {
      forgetSession(db, session_id);
      indexerState().located.delete(session_id);
    }
  }

  let spent = 0;
  const seen = new Set<string>();
  for (const session of sessions) {
    const where = await located(session).catch(() => null);
    const file = where?.file;
    if (!file || seen.has(file)) continue;
    seen.add(file);

    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (savedProgress(db, file)?.offset === size) continue;

    for (;;) {
      if (spent >= budgetMs) return true;
      const started = performance.now();
      let result: IndexFileResult;
      try {
        result = await indexFile(db, session.id, file, where.cwd);
      } catch (error) {
        console.error("[search] indexing", file, error);
        break;
      } finally {
        spent += performance.now() - started;
      }
      if (!result.more) break;
      await yieldNow();
    }
  }
  return false;
}

/**
 * Started once from lib/tickers.ts. Each interval checks flag
 * `searchIndex` (and AGENTOS_DISABLE_TICKERS through startTickers).
 */
export function startSearchIndexer(): void {
  const state = indexerState();
  if (state.started) return;
  state.started = true;

  const schedule = (ms: number) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
  };

  const run = async () => {
    let more = false;
    try {
      if (!tickersDisabled() && getFlags().searchIndex) {
        more = await indexTick();
      }
    } catch (error) {
      console.error("[search] index tick:", error);
    }
    schedule(more ? INDEX_AGAIN_MS : INDEX_INTERVAL_MS);
  };

  schedule(INDEX_INTERVAL_MS);
}
