"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import { fetchAsUser } from "@/lib/client/user-fetch";
import {
  QUEUE_OFF,
  QueueRequestError,
  moveItem,
  patchItem,
  queueErrorText,
  removeItem,
  upsertItem,
} from "@/components/Composer/queue-model";
import type {
  EditQueueItemRequest,
  EditQueueItemResult,
  EnqueueRequest,
  EnqueueResult,
  HoldReason,
  QueueItem,
  QueueState,
} from "@/lib/queue/types";

export const queueKeys = {
  session: (sessionId: string) => ["queue", sessionId] as const,
};

export interface UseQueue {
  /** Pending and sending, by position */
  items: QueueItem[];
  /** Messages that didn't go, with their error: Retry or dismiss */
  failed: QueueItem[];
  /** The undo notice the next message carries ("Claude will be told…") */
  notice: QueueItem | null;
  ready: boolean;
  holdReason: HoldReason | null;
  /** The server queue is on for this session; off, use the old send */
  enabled: boolean;
  /**
   * The server has answered at least once. Until then (loading, or its
   * reads failing) `enabled` is a guess: send through the queue, which
   * says when it's off
   */
  known: boolean;
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
  /** A failed message seen: off the list */
  dismiss: (itemId: number) => Promise<void>;
}

/** Busy or with something waiting: the queue changes by the second */
const ACTIVE_MS = 2000;
const IDLE_MS = 5000;
/** Off: only to notice the flag being switched on */
const OFF_MS = 30000;

async function fetchQueue(sessionId: string): Promise<QueueState> {
  const res = await fetch(`/api/sessions/${sessionId}/queue`);
  // No queue route (an older server) or no such session: the old send
  if (res.status === 501 || res.status === 404) return QUEUE_OFF;
  // Anything else keeps what was last known rather than guessing "off"
  if (!res.ok) throw new Error(`Queue: ${res.status}`);
  return (await res.json()) as QueueState;
}

/** A user action on the queue; rejects with the refusal in words */
async function request<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetchAsUser(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as {
    error?: string;
    reason?: string;
  } | null;
  if (!res.ok)
    throw new QueueRequestError(
      queueErrorText(res.status, json),
      res.status,
      json?.error ?? null
    );
  return json as T;
}

/**
 * A session's server queue (GET /api/sessions/[id]/queue), polled every 2s
 * while something waits or the session is held, 5s otherwise. The actions
 * change the cached state at once and put it back if the server refuses.
 * Whether a message goes now or waits is always the server's call
 */
export function useQueue(
  sessionId: string,
  { enabled = true }: { enabled?: boolean } = {}
): UseQueue {
  const queryClient = useQueryClient();
  const key = queueKeys.session(sessionId);
  const on = enabled && !!sessionId;
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchQueue(sessionId),
    enabled: on,
  });
  const state = data ?? QUEUE_OFF;
  const ms = !state.enabled
    ? OFF_MS
    : state.items.length || !state.ready
      ? ACTIVE_MS
      : IDLE_MS;
  useSharedPoll(key, ms, on);

  const base = `/api/sessions/${sessionId}/queue`;

  /** Applies `change` now; on a refusal the state goes back as it was */
  const optimistic = useCallback(
    async <T>(
      change: ((s: QueueState) => QueueState) | null,
      run: () => Promise<T>,
      settle?: (s: QueueState, result: T) => QueueState
    ): Promise<T> => {
      const queryKey = queueKeys.session(sessionId);
      await queryClient.cancelQueries({ queryKey });
      const before = queryClient.getQueryData<QueueState>(queryKey);
      if (before && change) queryClient.setQueryData(queryKey, change(before));
      try {
        const result = await run();
        if (settle)
          queryClient.setQueryData<QueueState>(queryKey, (s) =>
            s ? settle(s, result) : s
          );
        return result;
      } catch (e) {
        if (before) queryClient.setQueryData(queryKey, before);
        throw e;
      } finally {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, sessionId]
  );

  const post = useCallback(
    (
      text: string,
      sendNow: boolean,
      options: Omit<EnqueueRequest, "text" | "sendNow"> = {}
    ) => {
      const body: EnqueueRequest = { text, ...options, sendNow };
      return optimistic(
        null,
        () => request<EnqueueResult>(base, "POST", body),
        // Queued: it shows at once, before the next poll
        (s, { item, sent }) =>
          sent || item.kind === "undo_notice"
            ? s
            : { ...s, items: upsertItem(s.items, item) }
      );
    },
    [base, optimistic]
  );

  const send = useCallback<UseQueue["send"]>(
    (text, options) => post(text, true, options),
    [post]
  );
  const enqueue = useCallback<UseQueue["enqueue"]>(
    (text, options) => post(text, false, options),
    [post]
  );

  const edit = useCallback<UseQueue["edit"]>(
    (itemId, text) =>
      optimistic(
        (s) => ({ ...s, items: patchItem(s.items, itemId, { text }) }),
        () =>
          request<EditQueueItemResult>(`${base}/${itemId}`, "PATCH", {
            text,
          } satisfies EditQueueItemRequest)
      ),
    [base, optimistic]
  );

  const move = useCallback<UseQueue["move"]>(
    (itemId, position) =>
      optimistic(
        (s) => ({ ...s, items: moveItem(s.items, itemId, position) }),
        () =>
          request<EditQueueItemResult>(`${base}/${itemId}`, "PATCH", {
            position,
          } satisfies EditQueueItemRequest)
      ),
    [base, optimistic]
  );

  const cancel = useCallback<UseQueue["cancel"]>(
    async (itemId) => {
      await optimistic(
        (s) => ({ ...s, items: removeItem(s.items, itemId) }),
        () => request<{ ok: true }>(`${base}/${itemId}`, "DELETE")
      );
    },
    [base, optimistic]
  );

  const dismiss = useCallback<UseQueue["dismiss"]>(
    async (itemId) => {
      await optimistic(
        (s) => ({ ...s, failed: removeItem(s.failed, itemId) }),
        () => request<{ ok: true }>(`${base}/${itemId}`, "DELETE")
      );
    },
    [base, optimistic]
  );

  const noticeId = state.notice?.id;
  const dropNotice = useCallback<UseQueue["dropNotice"]>(async () => {
    if (noticeId === undefined) return;
    await optimistic(
      (s) => ({ ...s, notice: null }),
      () => request<{ ok: true }>(`${base}/${noticeId}`, "DELETE")
    );
  }, [base, noticeId, optimistic]);

  return useMemo(
    () => ({
      items: state.items,
      // An older server's state has none
      failed: state.failed ?? [],
      notice: state.notice,
      ready: state.ready,
      holdReason: state.holdReason,
      enabled: state.enabled,
      known: data !== undefined,
      isLoading: on && isLoading,
      send,
      enqueue,
      edit,
      move,
      cancel,
      dropNotice,
      dismiss,
    }),
    [
      state,
      data,
      on,
      isLoading,
      send,
      enqueue,
      edit,
      move,
      cancel,
      dropNotice,
      dismiss,
    ]
  );
}
