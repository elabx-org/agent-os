"use client";

import type { NewReviewComment, ReviewComment } from "@/lib/review-types";

export interface UseReviewSend {
  /**
   * The Duo's "Send to chat": sends this one comment now (the composer's
   * path: POST /queue {sendNow}, so it waits in the queue while the agent
   * works; the old direct send with the queue off), then records it sent
   */
  sendNow: (input: Omit<NewReviewComment, "sent">) => Promise<{
    comment: ReviewComment;
    /** False: it waits in the queue */
    sent: boolean;
  }>;
  /**
   * The desktop tray's "Send to Claude": every pending comment as one
   * message (formatReviewMessage), then marks them sent
   */
  sendPending: () => Promise<{ sent: boolean; count: number }>;
  sending: boolean;
  /** The last send's failure, for the tray or box to show */
  error: string | null;
}

/** M12 contract stub: U12.3 implements */
export function useReviewSend(
  sessionId: string,
  options: { enabled?: boolean } = {}
): UseReviewSend {
  void sessionId;
  void options;
  const no = () => Promise.reject(new Error("M12 contract stub"));
  return { sendNow: no, sendPending: no, sending: false, error: null };
}
