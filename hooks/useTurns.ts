"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import { queueKeys } from "@/hooks/useQueue";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type {
  Turn,
  TurnDetail,
  TurnsResponse,
  UndoResult,
} from "@/lib/turn-types";

export const turnsKeys = {
  session: (sessionId: string) => ["turns", sessionId] as const,
  detail: (sessionId: string, turnNo: number) =>
    ["turns", sessionId, turnNo] as const,
};

const TURNS_POLL_MS = 5000;

export interface UseTurns {
  /** Oldest first */
  turns: Turn[];
  /** Snapshots on for this session; off, no turn cards */
  enabled: boolean;
  isLoading: boolean;
  /** GET /turns/[n], for the undo sheet */
  detail: (turnNo: number) => Promise<TurnDetail>;
  /** POST /turns/[n]/undo through fetchAsUser; rejects with the reason */
  undo: (turnNo: number, paths: string[]) => Promise<UndoResult>;
}

const NO_TURNS: Turn[] = [];

async function fetchTurns(sessionId: string): Promise<TurnsResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/turns`);
  if (!res.ok) return { turns: [], enabled: false };
  return (await res.json()) as TurnsResponse;
}

/** An undo's refusal in words */
async function undoRefusal(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    reason?: string;
  } | null;
  if (res.status === 403) return refusalText(body ?? {});
  if (res.status === 409)
    return body?.reason === "undone"
      ? "This turn was already undone"
      : "Claude is working: undo once it's done";
  return body?.error ?? "Couldn't undo the turn";
}

/** A session's turns (GET /api/sessions/[id]/turns) */
export function useTurns(
  sessionId: string,
  { enabled = true }: { enabled?: boolean } = {}
): UseTurns {
  const queryClient = useQueryClient();
  const queryKey = turnsKeys.session(sessionId);
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchTurns(sessionId),
    enabled,
    staleTime: TURNS_POLL_MS,
  });
  useSharedPoll(queryKey, TURNS_POLL_MS, enabled);

  const detail = useCallback(
    (turnNo: number) =>
      queryClient.fetchQuery({
        queryKey: turnsKeys.detail(sessionId, turnNo),
        queryFn: async () => {
          const res = await fetch(
            `/api/sessions/${sessionId}/turns/${turnNo}`
          ).catch(() => {
            throw new Error("Couldn't reach the server");
          });
          if (!res.ok) throw new Error("Couldn't read this turn");
          return (await res.json()) as TurnDetail;
        },
        // Fresh each time the sheet opens: files change between turns
        staleTime: 0,
      }),
    [queryClient, sessionId]
  );

  const undo = useCallback(
    async (turnNo: number, paths: string[]) => {
      const res = await fetchAsUser(
        `/api/sessions/${sessionId}/turns/${turnNo}/undo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths }),
        }
      ).catch(() => {
        throw new Error("Couldn't reach the server");
      });
      if (!res.ok) throw new Error(await undoRefusal(res));
      const result = (await res.json()) as UndoResult;
      queryClient.invalidateQueries({ queryKey: turnsKeys.session(sessionId) });
      // The undo notice the next message carries
      queryClient.invalidateQueries({ queryKey: queueKeys.session(sessionId) });
      return result;
    },
    [queryClient, sessionId]
  );

  return {
    turns: (enabled && data?.turns) || NO_TURNS,
    enabled: enabled && !!data?.enabled,
    isLoading: enabled && isLoading,
    detail,
    undo,
  };
}
