/**
 * The review_comments table (migration 33): line comments on a session's
 * diff. Pending ones are the desktop tray (they survive a reload); sent ones
 * stay so the diff can show "Sent · …" on their lines. Deleted with the session.
 */

import path from "node:path";
import type Database from "better-sqlite3";
import { getDb, type ReviewCommentRow } from "./db";
import type { DiffScope } from "./turn-types";
import {
  MAX_COMMENT_BODY,
  MAX_COMMENT_QUOTE,
  type NewReviewComment,
  type ReviewComment,
  type ReviewSide,
} from "./review-types";

/** Sent comments kept per session (the oldest go first) */
export const SENT_HISTORY = 200;

export function toReviewComment(row: ReviewCommentRow): ReviewComment {
  return {
    id: row.id,
    sessionId: row.session_id,
    scope: row.scope as DiffScope,
    path: row.path,
    side: row.side === "old" ? "old" : "new",
    startLine: row.start_line,
    endLine: row.end_line,
    quote: row.quote,
    body: row.body,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

/** A scope as the diff route takes it (lib/turns-diff.ts parseScope), or null */
export function parseReviewScope(scope: unknown): DiffScope | null {
  if (scope === "branch" || scope === "uncommitted") return scope;
  if (typeof scope !== "string") return null;
  const m = scope.match(/^turn:(\d+)$/);
  return m ? (`turn:${Number(m[1])}` as DiffScope) : null;
}

/** A repo path the way lib/turns-diff.ts cleanFile takes it, or null */
function cleanPath(file: unknown): string | null {
  if (typeof file !== "string" || file === "" || file.includes("\0"))
    return null;
  const norm = path.posix.normalize(file.replace(/\\/g, "/"));
  if (path.posix.isAbsolute(norm) || norm === ".." || norm.startsWith("../"))
    return null;
  return norm;
}

const isLine = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1;

/** A POST body checked field by field: the comment, or why not */
export function parseNewComment(
  input: unknown
): { ok: true; comment: NewReviewComment } | { ok: false; error: string } {
  if (!input || typeof input !== "object")
    return { ok: false, error: "Bad comment" };
  const b = input as Record<string, unknown>;
  const scope = parseReviewScope(b.scope);
  if (!scope) return { ok: false, error: "Bad scope" };
  const file = cleanPath(b.path);
  if (!file) return { ok: false, error: "Bad file" };
  const side = b.side ?? "new";
  if (side !== "old" && side !== "new") return { ok: false, error: "Bad side" };
  if (!isLine(b.startLine) || !isLine(b.endLine) || b.startLine > b.endLine)
    return { ok: false, error: "Bad lines" };
  if (typeof b.body !== "string" || !b.body.trim())
    return { ok: false, error: "Comment required" };
  if (b.body.length > MAX_COMMENT_BODY)
    return { ok: false, error: "Comment too long" };
  if (typeof b.quote !== "string" || b.quote.length > MAX_COMMENT_QUOTE)
    return { ok: false, error: "Bad quote" };
  if (b.sent !== undefined && typeof b.sent !== "boolean")
    return { ok: false, error: "Bad sent" };
  return {
    ok: true,
    comment: {
      scope,
      path: file,
      side: side as ReviewSide,
      startLine: b.startLine,
      endLine: b.endLine,
      quote: b.quote,
      body: b.body.trim(),
      sent: b.sent === true,
    },
  };
}

/** A PATCH body's comment text, or why not */
export function parseCommentBody(
  input: unknown
): { ok: true; body: string } | { ok: false; error: string } {
  const body = (input as { body?: unknown } | null)?.body;
  if (typeof body !== "string" || !body.trim())
    return { ok: false, error: "Comment required" };
  if (body.length > MAX_COMMENT_BODY)
    return { ok: false, error: "Comment too long" };
  return { ok: true, body: body.trim() };
}

/** The comments' statements on one connection (tests open their own) */
export function createReviewStore(db: Database.Database) {
  const s = {
    get: db.prepare(
      `SELECT * FROM review_comments WHERE id = ? AND session_id = ?`
    ),
    // Pending (sent_at NULL) first, oldest first; then sent, newest first
    list: db.prepare(
      `SELECT * FROM review_comments WHERE session_id = ?
       ORDER BY sent_at IS NOT NULL, COALESCE(-sent_at, created_at), id`
    ),
    listScope: db.prepare(
      `SELECT * FROM review_comments WHERE session_id = ? AND scope = ?
       ORDER BY sent_at IS NOT NULL, COALESCE(-sent_at, created_at), id`
    ),
    insert: db.prepare(
      `INSERT INTO review_comments
         (session_id, scope, path, side, start_line, end_line, quote, body, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    setBody: db.prepare(
      `UPDATE review_comments SET body = ?
       WHERE id = ? AND session_id = ? AND sent_at IS NULL`
    ),
    removePending: db.prepare(
      `DELETE FROM review_comments
       WHERE id = ? AND session_id = ? AND sent_at IS NULL`
    ),
    discard: db.prepare(
      `DELETE FROM review_comments WHERE session_id = ? AND sent_at IS NULL`
    ),
    markSent: db.prepare(
      `UPDATE review_comments SET sent_at = ?
       WHERE id = ? AND session_id = ? AND sent_at IS NULL`
    ),
    // Sent ones beyond the newest SENT_HISTORY
    trim: db.prepare(
      `DELETE FROM review_comments WHERE session_id = ? AND id IN (
         SELECT id FROM review_comments
         WHERE session_id = ? AND sent_at IS NOT NULL
         ORDER BY sent_at DESC, id DESC LIMIT -1 OFFSET ?
       )`
    ),
    clear: db.prepare(`DELETE FROM review_comments WHERE session_id = ?`),
  };

  const row = (sessionId: string, id: number) =>
    s.get.get(id, sessionId) as ReviewCommentRow | undefined;
  const trim = (sessionId: string) =>
    s.trim.run(sessionId, sessionId, SENT_HISTORY);

  return {
    /** Pending first (oldest first), then sent (newest first); scope filters */
    list(sessionId: string, scope?: DiffScope | null): ReviewComment[] {
      const rows = scope
        ? s.listScope.all(sessionId, scope)
        : s.list.all(sessionId);
      return (rows as ReviewCommentRow[]).map(toReviewComment);
    },

    get(sessionId: string, id: number): ReviewComment | null {
      const r = row(sessionId, id);
      return r ? toReviewComment(r) : null;
    },

    add(sessionId: string, input: NewReviewComment): ReviewComment {
      return db.transaction(() => {
        const now = Date.now();
        const { lastInsertRowid } = s.insert.run(
          sessionId,
          input.scope,
          input.path,
          input.side,
          input.startLine,
          input.endLine,
          input.quote,
          input.body,
          now,
          input.sent ? now : null
        );
        if (input.sent) trim(sessionId);
        return toReviewComment(row(sessionId, Number(lastInsertRowid))!);
      })();
    },

    /** Pending only; null when missing or already sent */
    edit(sessionId: string, id: number, body: string): ReviewComment | null {
      if (s.setBody.run(body, id, sessionId).changes !== 1) return null;
      return toReviewComment(row(sessionId, id)!);
    },

    /** Pending only; false when missing or already sent */
    remove(sessionId: string, id: number): boolean {
      return s.removePending.run(id, sessionId).changes === 1;
    },

    /** Every pending comment of the session; how many went */
    discardPending(sessionId: string): number {
      return s.discard.run(sessionId).changes;
    },

    /** Pending ones among `ids` become sent (one transaction); returns them */
    markSent(
      sessionId: string,
      ids: number[],
      at = Date.now()
    ): ReviewComment[] {
      return db.transaction(() => {
        const flipped: ReviewComment[] = [];
        for (const id of new Set(ids)) {
          if (s.markSent.run(at, id, sessionId).changes === 1)
            flipped.push(toReviewComment(row(sessionId, id)!));
        }
        if (flipped.length) trim(sessionId);
        return flipped;
      })();
    },

    /** All of a session's comments (session delete) */
    removeSession(sessionId: string): void {
      s.clear.run(sessionId);
    },
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;

const stores = new WeakMap<Database.Database, ReviewStore>();

/** The store on the app's DB */
export function reviewStore(db: Database.Database = getDb()): ReviewStore {
  let store = stores.get(db);
  if (!store) {
    store = createReviewStore(db);
    stores.set(db, store);
  }
  return store;
}
