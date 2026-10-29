/**
 * A session's summary for @ attach (M9), cached in session_summaries
 * (migration 31): lib/summarize.ts buildSummary (extractive, never
 * `claude -p`), rebuilt when its basis changes (the transcript's size or
 * mtime for Claude, the pane's scrollback for other agents). Works for a
 * paused or ended session through lib/transcript-locate.ts.
 */

import fs from "fs/promises";
import type Database from "better-sqlite3";
import { getDb, type Session, type SessionSummaryRow } from "./db";
import type { SessionSummaryResponse } from "./session-attach-types";
import { buildSummary } from "./summarize";
import { locateTranscript } from "./transcript-locate";

/** A scrollback summary is rebuilt at most this often */
const SCROLLBACK_BUCKET_MS = 60_000;

export interface SessionSummaryOptions {
  /** Rebuild even when the cached basis still matches */
  fresh?: boolean;
}

/**
 * What the summary would be built from now: a new value means the cached
 * one is stale (e.g. "t:<size>:<mtimeMs>" for a transcript)
 */
export async function summaryBasis(
  session: Session,
  now = Date.now()
): Promise<string> {
  if ((session.agent_type || "claude") === "claude") {
    const located = await locateTranscript(session).catch(() => null);
    if (located?.file) {
      const stat = await fs.stat(located.file).catch(() => null);
      if (stat) return `t:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    }
  }
  return `s:${Math.floor(now / SCROLLBACK_BUCKET_MS)}`;
}

function toResponse(row: SessionSummaryRow): SessionSummaryResponse {
  return {
    text: row.text,
    tokens: row.tokens,
    basis: row.basis,
    source: row.source as SessionSummaryResponse["source"],
    empty: !!row.empty,
  };
}

/** The summary statements on one connection */
function statements(db: Database.Database) {
  return {
    get: db.prepare(`SELECT * FROM session_summaries WHERE session_id = ?`),
    put: db.prepare(
      `INSERT INTO session_summaries
         (session_id, basis, text, tokens, source, empty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET basis = excluded.basis,
         text = excluded.text, tokens = excluded.tokens,
         source = excluded.source, empty = excluded.empty,
         created_at = excluded.created_at`
    ),
    drop: db.prepare(`DELETE FROM session_summaries WHERE session_id = ?`),
  };
}

const cache = new WeakMap<Database.Database, ReturnType<typeof statements>>();
function stmts(db: Database.Database = getDb()) {
  let s = cache.get(db);
  if (!s) {
    s = statements(db);
    cache.set(db, s);
  }
  return s;
}

/** Builds in progress, so concurrent requests share one */
const inFlight = new Map<string, Promise<SessionSummaryResponse>>();

async function build(
  session: Session,
  basis: string
): Promise<SessionSummaryResponse> {
  const summary = await buildSummary(session, { purpose: "attach" });
  const response: SessionSummaryResponse = {
    text: summary.text,
    tokens: summary.tokens,
    basis,
    source: summary.source,
    empty: summary.empty,
  };
  stmts().put.run(
    session.id,
    basis,
    response.text,
    response.tokens,
    response.source,
    response.empty ? 1 : 0,
    Date.now()
  );
  return response;
}

/** The cached summary when its basis still matches, else a new one stored */
export async function getSessionSummary(
  session: Session,
  options: SessionSummaryOptions = {}
): Promise<SessionSummaryResponse> {
  const basis = await summaryBasis(session);
  if (!options.fresh) {
    const row = stmts().get.get(session.id) as SessionSummaryRow | undefined;
    if (row && row.basis === basis) return toResponse(row);
  }
  const running = inFlight.get(session.id);
  if (running) return running;
  const next = build(session, basis).finally(() => {
    if (inFlight.get(session.id) === next) inFlight.delete(session.id);
  });
  inFlight.set(session.id, next);
  return next;
}

/** Drops a session's cached summary (on session delete) */
export function forgetSessionSummary(sessionId: string): void {
  stmts().drop.run(sessionId);
}
