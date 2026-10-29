/**
 * Diff review (M12): line comments on a session's diff, the shapes of the
 * review-comments routes, shared with the client. No server imports.
 */

import type { DiffScope } from "./turn-types";

/** Which numbers a comment's lines are: the old file's (a deleted line) or the new one's */
export type ReviewSide = "old" | "new";

/** A run of lines in one file of a diff, on one side */
export interface LineRange {
  path: string;
  side: ReviewSide;
  /** 1-based, start <= end */
  startLine: number;
  endLine: number;
}

export interface ReviewComment extends LineRange {
  id: number;
  sessionId: string;
  /** The scope it was written on (turn:N, branch, uncommitted) */
  scope: DiffScope;
  /** The selected lines' text, as they read in the diff */
  quote: string;
  body: string;
  createdAt: number;
  /** Null while it waits in the tray; set once it went to the agent */
  sentAt: number | null;
  /**
   * Its message waits in the session's queue (behind a busy turn): neither
   * in the tray nor sent. It becomes sent when that message goes, and goes
   * back to the tray if the message is cancelled or fails
   */
  queueItemId: number | null;
}

/** GET /api/sessions/[id]/review-comments?scope= : pending, then sent */
export interface ReviewCommentsResponse {
  comments: ReviewComment[];
}

/** POST /api/sessions/[id]/review-comments (the user's only) */
export interface NewReviewComment extends LineRange {
  scope: DiffScope;
  quote: string;
  body: string;
  /**
   * Already sent (the Duo's "Send to chat" sends first, then records it so
   * the diff shows "Sent · …" on the line); default false = the tray's
   */
  sent?: boolean;
  /** Not sent but queued: the queue item carrying it (sent must be false) */
  queueItemId?: number;
}

export interface ReviewCommentResult {
  comment: ReviewComment;
}

/** PATCH /api/sessions/[id]/review-comments/[commentId]: pending only */
export interface EditReviewCommentRequest {
  body: string;
}

/**
 * POST /api/sessions/[id]/review-comments/sent {ids}: marks pending
 * comments sent after their message went (through the queue)
 */
export interface MarkSentRequest {
  ids: number[];
  /**
   * The message only went into the queue: the comments wait for this item
   * (of the same session) instead of becoming sent now
   */
  queueItemId?: number;
}

export interface MarkSentResult {
  comments: ReviewComment[];
}

/**
 * DELETE /api/sessions/[id]/review-comments?pending=1 (the tray's Discard):
 * every pending comment of the session; DELETE .../[commentId] removes one
 */
export interface DiscardResult {
  removed: number;
}

/** Longest comment body and quote the routes accept */
export const MAX_COMMENT_BODY = 10_000;
export const MAX_COMMENT_QUOTE = 20_000;
