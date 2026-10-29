"use client";

import type {
  EditQueueItemResult,
  EnqueueRequest,
  EnqueueResult,
  HoldReason,
  QueueItem,
} from "@/lib/queue/types";

export const queueKeys = {
  session: (sessionId: string) => ["queue", sessionId] as const,
};

export interface UseQueue {
  /** Pending and sending, by position */
  items: QueueItem[];
  /** The undo notice the next message carries ("Claude will be told…") */
  notice: QueueItem | null;
  ready: boolean;
  holdReason: HoldReason | null;
  /** The server queue is on for this session; off, use the old send */
  enabled: boolean;
  isLoading: boolean;
  /** POST {sendNow: true}: the server sends it or queues it */
  send: (
    text: string,
    options?: Omit<EnqueueRequest, "text" | "sendNow">
  ) => Promise<EnqueueResult>;
  /** POST {sendNow: false}: always waits its turn */
  enqueue: (
    text: string,
    options?: Omit<EnqueueRequest, "text" | "sendNow">
  ) => Promise<EnqueueResult>;
  edit: (itemId: number, text: string) => Promise<EditQueueItemResult>;
  /** To a 1-based place among the pending items */
  move: (itemId: number, position: number) => Promise<EditQueueItemResult>;
  cancel: (itemId: number) => Promise<void>;
  /** Drops the undo notice (its ×) */
  dropNotice: () => Promise<void>;
}

const notImplemented = () => Promise.reject(new Error("Not implemented"));

// M2 contract: the shape only; U2.4 implements it over useSharedPoll
// (GET /api/sessions/[id]/queue, 2s while there are items or it is held)

/** A session's server queue */
export function useQueue(
  _sessionId: string,
  _options: { enabled?: boolean } = {}
): UseQueue {
  return {
    items: [],
    notice: null,
    ready: false,
    holdReason: null,
    enabled: false,
    isLoading: false,
    send: notImplemented,
    enqueue: notImplemented,
    edit: notImplemented,
    move: notImplemented,
    cancel: notImplemented,
    dropNotice: notImplemented,
  };
}
