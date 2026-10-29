"use client";

import { useQuery } from "@tanstack/react-query";
import type { SessionSummaryResponse } from "@/lib/session-attach-types";

export const sessionSummaryKeys = {
  summary: (sessionId: string) => ["session-summary", sessionId] as const,
};

/** A summary's size changes as its session goes on: a minute is plenty */
export const SESSION_SUMMARY_STALE_MS = 60_000;

/** GET /api/sessions/[id]/summary; throws when it can't be had (a 501 too) */
export async function fetchSessionSummary(
  sessionId: string
): Promise<SessionSummaryResponse> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/summary`
  );
  if (!res.ok) throw new Error(`Summary ${res.status}`);
  return res.json();
}

/** The react-query options the rows, the chips and this hook share */
export function sessionSummaryQuery(sessionId: string, enabled: boolean) {
  return {
    queryKey: sessionSummaryKeys.summary(sessionId),
    queryFn: () => fetchSessionSummary(sessionId),
    enabled: enabled && !!sessionId,
    staleTime: SESSION_SUMMARY_STALE_MS,
    retry: false,
  };
}

export interface UseSessionSummary {
  summary: SessionSummaryResponse | null;
  loading: boolean;
}

/** GET /api/sessions/[id]/summary while `enabled` (M9 chip and rows) */
export function useSessionSummary(
  sessionId: string | null,
  enabled = true
): UseSessionSummary {
  const query = useQuery(sessionSummaryQuery(sessionId ?? "", enabled));
  return {
    summary: query.data ?? null,
    loading: query.isLoading && query.fetchStatus !== "idle",
  };
}
