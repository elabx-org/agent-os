"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBackgroundAgents } from "@/components/BackgroundAgents";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type { SessionStatus } from "@/components/views/types";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { Session } from "@/lib/db";
import { isLimitShown } from "@/lib/limits/types";
import type { NotificationEntry } from "@/lib/push/history";

export type { NotificationEntry };

interface NotificationHistory {
  items: NotificationEntry[];
  unread: number;
  lastSeen: number;
}

export const notificationKeys = {
  all: ["notifications"] as const,
};

// The watcher follows background agents every 10s: no point asking faster
const HISTORY_POLL_MS = 10000;
const EMPTY_ITEMS: NotificationEntry[] = [];

async function fetchHistory(): Promise<NotificationHistory> {
  const res = await fetch("/api/notifications");
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export interface NeedsYou {
  /** Waiting sessions plus blocked agents: the one "needs you" number */
  count: number;
  /** Waiting sessions (not workers), most recently used first */
  waiting: Session[];
  /** Blocked background agents (parked ones are listed as sessions) */
  blocked: BackgroundAgent[];
  /** Every background agent, from the one shared poll */
  agents: BackgroundAgent[];
  /** What needed you or happened lately, newest first */
  history: NotificationEntry[];
  unread: number;
  /** Marks history read: some ids, or "all" */
  markRead: (ids: string[] | "all") => void;
  /** Empties the history (DELETE /api/notifications), shown at once */
  clearHistory: () => void;
}

/**
 * The one definition of what needs you, for the column badge, the iOS
 * app's count, the Now hero and the Needs you page: waiting sessions (not
 * workers, which show inside their conductor) plus blocked background
 * agents, with the server's history of what happened lately beside them.
 */
export function useNeedsYou(
  sessions: Session[],
  statuses: Record<string, SessionStatus>
): NeedsYou {
  const agents = useBackgroundAgents();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: notificationKeys.all,
    queryFn: fetchHistory,
    staleTime: HISTORY_POLL_MS / 2,
  });
  useSharedPoll(notificationKeys.all, HISTORY_POLL_MS);

  const { mutate } = useMutation({
    mutationFn: async (ids: string[] | "all") => {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: ids }),
      });
      if (!res.ok) throw new Error("Failed to mark notifications read");
      return (await res.json()) as NotificationHistory;
    },
    onSuccess: (history) =>
      queryClient.setQueryData(notificationKeys.all, history),
  });
  const markRead = useCallback(
    (ids: string[] | "all") => mutate(ids),
    [mutate]
  );

  // Empty at once; the server's list (or, failing that, a refetch) follows
  const { mutate: clear } = useMutation({
    mutationFn: async () => {
      const res = await fetchAsUser("/api/notifications", {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusalText(body));
      return body as NotificationHistory;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      queryClient.setQueryData<NotificationHistory>(notificationKeys.all, {
        items: [],
        unread: 0,
        lastSeen: Date.now(),
      });
    },
    onSuccess: (history) =>
      queryClient.setQueryData(notificationKeys.all, history),
    onError: (error) => {
      toast.error(`Couldn't clear the history: ${error.message}`);
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
  const clearHistory = useCallback(() => clear(), [clear]);

  const waiting = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            !s.conductor_session_id &&
            statuses[s.id]?.status === "waiting" &&
            // A limited session is listed under Limited, not twice
            !isLimitShown(s)
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [sessions, statuses]
  );
  const blocked = useMemo(
    () => agents.filter((a) => a.state === "blocked"),
    [agents]
  );

  return {
    count: waiting.length + blocked.length,
    waiting,
    blocked,
    agents,
    history: data?.items ?? EMPTY_ITEMS,
    unread: data?.unread ?? 0,
    markRead,
    clearHistory,
  };
}

/** History ids already shown; null until the first list has been learned */
let noticed: Set<string> | null = null;

/**
 * Tells you about background agents as their history lands: sessions have
 * their own track (useNotifications' checkStateChanges), agents only reach
 * the browser through the server's history. The first list only learns, and
 * the ids are kept per page, so each event shows once however many callers.
 */
export function useAgentNotices(
  history: NotificationEntry[],
  notice: (entry: NotificationEntry) => void
) {
  useEffect(() => {
    if (history === EMPTY_ITEMS) return;
    if (!noticed) {
      noticed = new Set(history.map((i) => i.id));
      return;
    }
    // Oldest first, so toasts stack in the order things happened
    for (const entry of [...history].reverse()) {
      if (noticed.has(entry.id)) continue;
      noticed.add(entry.id);
      if (entry.kind === "agentNeedsYou" || entry.kind === "agentFinished")
        notice(entry);
    }
  }, [history, notice]);
}
