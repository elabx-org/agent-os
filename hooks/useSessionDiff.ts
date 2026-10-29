"use client";

import type { DiffScope, SessionDiff } from "@/lib/turn-types";

export const sessionDiffKeys = {
  scope: (sessionId: string, scope: DiffScope) =>
    ["session-diff", sessionId, scope] as const,
};

export interface UseSessionDiff {
  diff: SessionDiff | null;
  isLoading: boolean;
  /** "Couldn't load …", or null */
  error: string | null;
  refetch: () => void;
}

/**
 * GET /api/sessions/[id]/diff?scope= for the review: refetched when the
 * scope changes and when the session's turns change (a turn ended, undone).
 * M12 contract stub: U12.1 implements
 */
export function useSessionDiff(
  sessionId: string,
  scope: DiffScope,
  options: { enabled?: boolean } = {}
): UseSessionDiff {
  void sessionId;
  void scope;
  void options;
  return { diff: null, isLoading: true, error: null, refetch: () => {} };
}
