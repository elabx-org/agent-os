/**
 * How review comments reach the agent (hooks/useReviewSend.ts): the
 * composer's send rule, which comments the tray sends, and the failure in
 * words. No React, so tests/unit/review-send.test.ts runs it.
 */

import {
  QueueRequestError,
  isQueueOff,
} from "@/components/Composer/queue-model";
import { refusalText } from "@/lib/client/user-fetch";
import type { ReviewComment } from "./review-types";

/** The two ways a message goes, as ComposerCard has them */
export interface SendRoute {
  /** The server queue is on for the session */
  queueEnabled: boolean;
  /** The queue state has been read at least once */
  queueKnown: boolean;
  /** POST /queue {sendNow}: resolves sent=false when it waits */
  queueSend: (
    text: string
  ) => Promise<{ sent: boolean; item?: { id: number } }>;
  /** The old send-keys send */
  direct: (text: string) => Promise<void>;
}

/**
 * ComposerCard's rule: through the queue while it's on or not known yet (it
 * says when it's off), else the old direct send. sent=false: it waits in
 * the queue behind the agent's turn, as queue item `itemId`
 */
export async function deliver(
  text: string,
  route: SendRoute
): Promise<{ sent: boolean; itemId?: number }> {
  if (route.queueEnabled || !route.queueKnown) {
    try {
      const { sent, item } = await route.queueSend(text);
      return sent || !item ? { sent } : { sent, itemId: item.id };
    } catch (e) {
      if (!isQueueOff(e)) throw e;
    }
  }
  await route.direct(text);
  return { sent: true };
}

/** A refused send-keys request, with the route's JSON body */
export class DirectSendError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; reason?: string } | null
  ) {
    super(`send-keys: ${status}`);
    this.name = "DirectSendError";
  }
}

/** The tray's (and the comment box's) words for a failed send */
export function sendErrorText(error: unknown, agentName: string): string {
  // The queue's refusals are already in words (user_only included)
  if (error instanceof QueueRequestError) return error.message;
  if (error instanceof DirectSendError) {
    if (error.status === 403 && error.body) return refusalText(error.body);
    if (error.body?.error) return error.body.error;
  }
  return `Couldn't send to ${agentName}`;
}

/** In the tray: not sent, not waiting in the queue */
export function inTray(c: Pick<ReviewComment, "sentAt" | "queueItemId">) {
  return c.sentAt === null && c.queueItemId === null;
}

/** The tray's comments in the order they were written (one message) */
export function oldestFirst<T extends Pick<ReviewComment, "id" | "createdAt">>(
  comments: readonly T[]
): T[] {
  return [...comments].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

/** "1 comment", "2 comments" */
export function commentCount(n: number): string {
  return `${n} ${n === 1 ? "comment" : "comments"}`;
}
