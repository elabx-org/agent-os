"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTurns } from "@/hooks/useTurns";
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

const LOAD_ERROR = "Couldn't load the changes";

async function fetchDiff(
  sessionId: string,
  scope: DiffScope
): Promise<SessionDiff> {
  const res = await fetch(
    `/api/sessions/${sessionId}/diff?scope=${encodeURIComponent(scope)}`
  ).catch(() => {
    throw new Error(LOAD_ERROR);
  });
  if (!res.ok) throw new Error(LOAD_ERROR);
  return (await res.json()) as SessionDiff;
}

/**
 * GET /api/sessions/[id]/diff?scope= for the review: refetched when the
 * scope changes and when the session's turns change (a turn ended, undone):
 * the turns' latest end/undo time is part of the key
 */
export function useSessionDiff(
  sessionId: string,
  scope: DiffScope,
  { enabled = true }: { enabled?: boolean } = {}
): UseSessionDiff {
  const on = enabled && !!sessionId;
  const { turns } = useTurns(sessionId, { enabled: on });
  const version = useMemo(
    () =>
      turns
        .map((t) => `${t.turnNo}:${t.endedAt ?? "-"}:${t.undoneAt ?? "-"}`)
        .join(","),
    [turns]
  );
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...sessionDiffKeys.scope(sessionId, scope), version] as const,
    queryFn: () => fetchDiff(sessionId, scope),
    enabled: on,
    // A turn ending keeps the old diff on screen until the new one is in;
    // another scope starts empty rather than showing the wrong files
    placeholderData: (previous, query) =>
      query?.queryKey[2] === scope ? previous : undefined,
  });
  const again = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    diff: (on && data) || null,
    isLoading: on && isLoading,
    error: on && error ? LOAD_ERROR : null,
    refetch: again,
  };
}
