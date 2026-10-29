/**
 * The review_comments table (migration 33): line comments on a session's
 * diff. Pending ones are the desktop tray (they survive a reload); sent ones
 * stay so the diff can show "Sent · …" on their lines. Deleted with the session.
 */

import type Database from "better-sqlite3";
import type { ReviewCommentRow } from "./db";
import type { DiffScope } from "./turn-types";
import type { NewReviewComment, ReviewComment } from "./review-types";

export function toReviewComment(row: ReviewCommentRow): ReviewComment {
  void row;
  throw new Error("M12 contract stub: toReviewComment");
}

/** The comments' statements on one connection (tests open their own) */
export function createReviewStore(db: Database.Database) {
  void db;
  return {
    /** Pending first (oldest first), then sent (newest first); scope filters */
    list(sessionId: string, scope?: DiffScope | null): ReviewComment[] {
      void sessionId;
      void scope;
      throw new Error("M12 contract stub: list");
    },
    get(sessionId: string, id: number): ReviewComment | null {
      void sessionId;
      void id;
      throw new Error("M12 contract stub: get");
    },
    add(sessionId: string, input: NewReviewComment): ReviewComment {
      void sessionId;
      void input;
      throw new Error("M12 contract stub: add");
    },
    /** Pending only; null when missing or already sent */
    edit(sessionId: string, id: number, body: string): ReviewComment | null {
      void sessionId;
      void id;
      void body;
      throw new Error("M12 contract stub: edit");
    },
    /** Pending only; false when missing or already sent */
    remove(sessionId: string, id: number): boolean {
      void sessionId;
      void id;
      throw new Error("M12 contract stub: remove");
    },
    /** Every pending comment of the session; how many went */
    discardPending(sessionId: string): number {
      void sessionId;
      throw new Error("M12 contract stub: discardPending");
    },
    /** Pending ones among `ids` become sent (one transaction); returns them */
    markSent(sessionId: string, ids: number[], at?: number): ReviewComment[] {
      void sessionId;
      void ids;
      void at;
      throw new Error("M12 contract stub: markSent");
    },
    /** All of a session's comments (session delete) */
    removeSession(sessionId: string): void {
      void sessionId;
      throw new Error("M12 contract stub: removeSession");
    },
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;

/** The store on the app's DB */
export function reviewStore(db?: Database.Database): ReviewStore {
  void db;
  throw new Error("M12 contract stub: reviewStore");
}
