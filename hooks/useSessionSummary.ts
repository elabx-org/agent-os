"use client";

import type { SessionSummaryResponse } from "@/lib/session-attach-types";

export const sessionSummaryKeys = {
  summary: (sessionId: string) => ["session-summary", sessionId] as const,
};

export interface UseSessionSummary {
  summary: SessionSummaryResponse | null;
  loading: boolean;
}

/** GET /api/sessions/[id]/summary while `enabled` (M9 chip and rows) */
export function useSessionSummary(
  _sessionId: string | null,
  _enabled = true
): UseSessionSummary {
  return { summary: null, loading: false }; // M9 U2
}
