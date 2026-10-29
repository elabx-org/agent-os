"use client";

import type { NewReviewComment, ReviewComment } from "@/lib/review-types";
import type { DiffScope } from "@/lib/turn-types";

export const reviewKeys = {
  session: (sessionId: string) => ["review-comments", sessionId] as const,
};

export interface UseReviewComments {
  /** Every comment of the session: pending first, then sent */
  comments: ReviewComment[];
  /** The tray's: not sent yet */
  pending: ReviewComment[];
  isLoading: boolean;
  add: (input: NewReviewComment) => Promise<ReviewComment>;
  edit: (id: number, body: string) => Promise<ReviewComment>;
  remove: (id: number) => Promise<void>;
  /** The tray's Discard: every pending comment */
  discard: () => Promise<void>;
  markSent: (ids: number[]) => Promise<ReviewComment[]>;
}

/**
 * The session's line comments (all scopes; the review filters by path and
 * scope), user-proofed writes, optimistic. M12 contract stub: U12.1 implements
 */
export function useReviewComments(
  sessionId: string,
  options: { enabled?: boolean; scope?: DiffScope } = {}
): UseReviewComments {
  void sessionId;
  void options;
  const no = () => Promise.reject(new Error("M12 contract stub"));
  return {
    comments: [],
    pending: [],
    isLoading: true,
    add: no,
    edit: no,
    remove: no,
    discard: no,
    markSent: no,
  };
}
