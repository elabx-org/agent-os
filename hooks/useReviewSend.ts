"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueue } from "@/hooks/useQueue";
import { useReviewComments } from "@/hooks/useReviewComments";
import { fetchAsUser } from "@/lib/client/user-fetch";
import { formatReviewMessage } from "@/lib/review-format";
import {
  DirectSendError,
  deliver,
  oldestFirst,
  sendErrorText,
} from "@/lib/review-send";
import type { NewReviewComment, ReviewComment } from "@/lib/review-types";

export interface UseReviewSend {
  /**
   * The Duo's "Send to chat": sends this one comment now (the composer's
   * path: POST /queue {sendNow}, so it waits in the queue while the agent
   * works; the old direct send with the queue off), then records it sent.
   * Rejects (and sets `error`) when it didn't go
   */
  sendNow: (input: Omit<NewReviewComment, "sent">) => Promise<{
    comment: ReviewComment;
    /** False: it waits in the queue */
    sent: boolean;
  }>;
  /**
   * The desktop tray's "Send to Claude": every pending comment as one
   * message (formatReviewMessage), then marks them sent. Never rejects: on
   * a failure the comments stay pending, `error` says why and count is 0
   */
  sendPending: () => Promise<{ sent: boolean; count: number }>;
  sending: boolean;
  /** The last send's failure, for the tray or box to show */
  error: string | null;
}

/**
 * Sends line comments to the session's agent the way the composer sends a
 * message, and records them in the session's review comments
 */
export function useReviewSend(
  sessionId: string,
  { enabled = true }: { enabled?: boolean } = {}
): UseReviewSend {
  const queue = useQueue(sessionId, { enabled });
  const review = useReviewComments(sessionId, { enabled });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One send at a time, also between two clicks in one render
  const inFlight = useRef(false);
  const agentName = "Claude";

  const direct = useCallback(
    async (text: string) => {
      const res = await fetchAsUser(`/api/sessions/${sessionId}/send-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), pressEnter: true }),
      });
      if (!res.ok)
        throw new DirectSendError(
          res.status,
          await res.json().catch(() => null)
        );
    },
    [sessionId]
  );

  const send = useCallback(
    (text: string) =>
      deliver(text, {
        queueEnabled: queue.enabled,
        queueKnown: queue.known,
        queueSend: queue.send,
        direct,
      }),
    [queue.enabled, queue.known, queue.send, direct]
  );

  /** Runs one send with the flag up; null when another one is going */
  const run = useCallback(async <T>(work: () => Promise<T>) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      return { value: await work() };
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, []);

  const { add, markSent, pending } = review;

  const sendNow = useCallback<UseReviewSend["sendNow"]>(
    async (input) => {
      // Set once the message went (true) or waits in the queue (false)
      const went: { sent?: boolean } = {};
      let done: { value: { comment: ReviewComment; sent: boolean } } | null;
      try {
        done = await run(async () => {
          ({ sent: went.sent } = await send(formatReviewMessage([input])));
          const comment = await add({ ...input, sent: true });
          return { comment, sent: !!went.sent };
        });
      } catch (e) {
        // Gone (or queued) but not recorded: say so, not "couldn't send"
        const text =
          went.sent === undefined
            ? sendErrorText(e, agentName)
            : went.sent
              ? `Sent to ${agentName}, but the comment wasn't saved`
              : "Queued, but the comment wasn't saved";
        setError(text);
        throw new Error(text);
      }
      if (!done) throw new Error("Already sending");
      return done.value;
    },
    [run, send, add]
  );

  const sendPending = useCallback<UseReviewSend["sendPending"]>(async () => {
    const batch = oldestFirst(pending);
    if (!batch.length) return { sent: false, count: 0 };
    let delivered = false;
    try {
      const done = await run(async () => {
        const { sent } = await send(formatReviewMessage(batch));
        delivered = true;
        await markSent(batch.map((c) => c.id));
        return { sent, count: batch.length };
      });
      return done?.value ?? { sent: false, count: 0 };
    } catch (e) {
      // Gone but still in the tray: say so rather than invite a second send
      setError(
        delivered
          ? `Sent to ${agentName}, but the tray couldn't be cleared`
          : sendErrorText(e, agentName)
      );
      return { sent: false, count: 0 };
    }
  }, [pending, run, send, markSent]);

  return useMemo(
    () => ({ sendNow, sendPending, sending, error }),
    [sendNow, sendPending, sending, error]
  );
}
