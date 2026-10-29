"use client";

import type { LimitState, ResumeResult, ResumeWhen } from "@/lib/limits/types";
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

/** A session's limit and its resume actions. M6 U6.3 implements */
export function useSessionLimit(_session: Session): UseSessionLimit {
  throw new Error("useSessionLimit: not implemented (M6 U6.3)");
}
