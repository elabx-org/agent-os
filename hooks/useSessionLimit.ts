"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  limitStateOf,
  type LimitState,
  type ResumeRequest,
  type ResumeResult,
  type ResumeWhen,
} from "@/lib/limits/types";
import { fetchAsUser } from "@/lib/client/user-fetch";
import { sessionKeys } from "@/data/sessions/keys";
import { queueKeys } from "@/hooks/useQueue";
import {
  nextLimitChange,
  resumeErrorText,
  withLimitState,
} from "@/components/Chat/limited-model";
import type { Session } from "@/lib/db";

export interface UseSessionLimit {
  /** limitStateOf(session), re-read as the clock passes the reset */
  state: LimitState;
  /** POST /api/sessions/[id]/resume; refreshes the sessions query */
  resume: (when: ResumeWhen, text?: string) => Promise<ResumeResult>;
  /** DELETE /api/sessions/[id]/resume */
  cancel: () => Promise<ResumeResult>;
  pending: boolean;
  error: string | null;
}

/** setTimeout's ceiling (~24.8 days): longer waits wake up and look again */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The clock the limit views read: now, moved on when it passes the next of
 * `untils` (a reset), and every `everyMs` when given (the "in 1h 12m" on a
 * card). One timer, no polling while nothing is limited
 */
export function useLimitClock(
  untils: (number | null | undefined)[],
  everyMs?: number
): number {
  const [now, setNow] = useState(() => Date.now());
  const key = untils.join(",");
  const next = nextLimitChange(untils, now);
  useEffect(() => {
    const waits: number[] = [];
    // A beat after the reset, so limitStateOf reads it as passed
    if (next !== null) waits.push(next - Date.now() + 250);
    if (everyMs) waits.push(everyMs);
    if (!waits.length) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(MAX_TIMEOUT_MS, Math.max(0, Math.min(...waits)))
    );
    return () => clearTimeout(timer);
    // `key` stands for `untils`; `now` re-arms after each wake
  }, [key, next, everyMs, now]);
  return now;
}

interface SessionsData {
  sessions: Session[];
}

/** A session's limit and its resume actions */
export function useSessionLimit(session: Session): UseSessionLimit {
  const queryClient = useQueryClient();
  const now = useLimitClock([session.limited_until]);
  const state = useMemo(
    () => limitStateOf(session, now),
    // The row's limit columns are all it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      session.limited_at,
      session.limited_until,
      session.limit_kind,
      session.resume_policy,
      session.resume_text,
      now,
    ]
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = session.id;

  const call = useCallback(
    async (method: "POST" | "DELETE", body?: ResumeRequest) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetchAsUser(`/api/sessions/${id}/resume`, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = (await res.json().catch(() => null)) as
          | (ResumeResult & { error?: string; reason?: string })
          | null;
        if (!res.ok || !data?.state)
          throw new Error(resumeErrorText(res.status, data));
        // The card changes now; the refetch below confirms it
        queryClient.setQueryData<SessionsData>(sessionKeys.list(), (old) =>
          old
            ? {
                ...old,
                sessions: old.sessions.map((s) =>
                  s.id === id ? withLimitState(s, data.state) : s
                ),
              }
            : old
        );
        return data as ResumeResult;
      } catch (e) {
        const text = e instanceof Error ? e.message : "Something went wrong";
        setError(text);
        toast.error(text);
        throw e;
      } finally {
        setPending(false);
        queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
        queryClient.invalidateQueries({ queryKey: queueKeys.session(id) });
      }
    },
    [id, queryClient]
  );

  const resume = useCallback(
    (when: ResumeWhen, text?: string) =>
      call("POST", text === undefined ? { when } : { when, text }),
    [call]
  );
  const cancel = useCallback(() => call("DELETE"), [call]);

  return { state, resume, cancel, pending, error };
}
