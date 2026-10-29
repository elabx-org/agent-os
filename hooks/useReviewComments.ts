"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type {
  DiscardResult,
  MarkSentResult,
  NewReviewComment,
  ReviewComment,
  ReviewCommentResult,
  ReviewCommentsResponse,
} from "@/lib/review-types";
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

const NONE: ReviewComment[] = [];
/** Another tab or device may add some; the review's own writes refresh it */
const STALE_MS = 15000;

async function fetchComments(sessionId: string): Promise<ReviewComment[]> {
  const res = await fetch(`/api/sessions/${sessionId}/review-comments`);
  if (!res.ok) throw new Error(`Review comments: ${res.status}`);
  return ((await res.json()) as ReviewCommentsResponse).comments;
}

/** A user write; rejects with the refusal in words */
async function request<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetchAsUser(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error("Couldn't reach the server");
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; reason?: string })
    | null;
  if (!res.ok) {
    if (res.status === 409) throw new Error("This comment was already sent");
    if (res.status === 404 && json?.error === "Comment not found")
      throw new Error("This comment isn't there any more");
    throw new Error(
      refusalText(json ?? { error: "Couldn't save the comment" })
    );
  }
  return json as T;
}

/** Pending first (oldest first), then sent (newest first), as the server lists */
function ordered(list: ReviewComment[]): ReviewComment[] {
  const pending = list
    .filter((c) => c.sentAt === null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  const sent = list
    .filter((c) => c.sentAt !== null)
    .sort((a, b) => b.sentAt! - a.sentAt! || a.id - b.id);
  return [...pending, ...sent];
}

let tempId = 0;

/**
 * The session's line comments (all scopes; the review filters by path and
 * scope), user-proofed writes, optimistic. With `scope`, `comments` holds
 * that scope's only; `pending` is always every pending one (the tray sends
 * them all as one message)
 */
export function useReviewComments(
  sessionId: string,
  { enabled = true, scope }: { enabled?: boolean; scope?: DiffScope } = {}
): UseReviewComments {
  const queryClient = useQueryClient();
  const on = enabled && !!sessionId;
  const { data, isLoading } = useQuery({
    queryKey: reviewKeys.session(sessionId),
    queryFn: () => fetchComments(sessionId),
    enabled: on,
    staleTime: STALE_MS,
  });

  const base = `/api/sessions/${sessionId}/review-comments`;

  /** Applies `change` now; on a refusal the list goes back as it was */
  const optimistic = useCallback(
    async <T>(
      change: (list: ReviewComment[]) => ReviewComment[],
      run: () => Promise<T>,
      settle?: (list: ReviewComment[], result: T) => ReviewComment[]
    ): Promise<T> => {
      const queryKey = reviewKeys.session(sessionId);
      await queryClient.cancelQueries({ queryKey });
      const before = queryClient.getQueryData<ReviewComment[]>(queryKey);
      if (before) queryClient.setQueryData(queryKey, ordered(change(before)));
      try {
        const result = await run();
        if (settle)
          queryClient.setQueryData<ReviewComment[]>(queryKey, (list) =>
            list ? ordered(settle(list, result)) : list
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

  const add = useCallback<UseReviewComments["add"]>(
    async (input) => {
      const now = Date.now();
      const { sent, ...fields } = input;
      const temp: ReviewComment = {
        ...fields,
        id: -++tempId,
        sessionId,
        createdAt: now,
        sentAt: sent ? now : null,
      };
      const { comment } = await optimistic(
        (list) => [...list, temp],
        () => request<ReviewCommentResult>(base, "POST", input),
        (list, { comment }) => list.map((c) => (c.id === temp.id ? comment : c))
      );
      return comment;
    },
    [base, optimistic, sessionId]
  );

  const edit = useCallback<UseReviewComments["edit"]>(
    async (id, body) => {
      const { comment } = await optimistic(
        (list) => list.map((c) => (c.id === id ? { ...c, body } : c)),
        () => request<ReviewCommentResult>(`${base}/${id}`, "PATCH", { body }),
        (list, { comment }) => list.map((c) => (c.id === id ? comment : c))
      );
      return comment;
    },
    [base, optimistic]
  );

  const remove = useCallback<UseReviewComments["remove"]>(
    async (id) => {
      await optimistic(
        (list) => list.filter((c) => c.id !== id),
        () => request<DiscardResult>(`${base}/${id}`, "DELETE")
      );
    },
    [base, optimistic]
  );

  const discard = useCallback<UseReviewComments["discard"]>(async () => {
    await optimistic(
      (list) => list.filter((c) => c.sentAt !== null),
      () => request<DiscardResult>(`${base}?pending=1`, "DELETE")
    );
  }, [base, optimistic]);

  const markSent = useCallback<UseReviewComments["markSent"]>(
    async (ids) => {
      const now = Date.now();
      const which = new Set(ids);
      const { comments } = await optimistic(
        (list) =>
          list.map((c) =>
            which.has(c.id) && c.sentAt === null ? { ...c, sentAt: now } : c
          ),
        () => request<MarkSentResult>(`${base}/sent`, "POST", { ids }),
        (list, { comments }) => {
          const byId = new Map(comments.map((c) => [c.id, c]));
          return list.map((c) => byId.get(c.id) ?? c);
        }
      );
      return comments;
    },
    [base, optimistic]
  );

  const all = (on && data) || NONE;
  const comments = useMemo(
    () => (scope ? all.filter((c) => c.scope === scope) : all),
    [all, scope]
  );
  const pending = useMemo(() => all.filter((c) => c.sentAt === null), [all]);

  return useMemo(
    () => ({
      comments,
      pending,
      isLoading: on && isLoading,
      add,
      edit,
      remove,
      discard,
      markSent,
    }),
    [comments, pending, on, isLoading, add, edit, remove, discard, markSent]
  );
}
