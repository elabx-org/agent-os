"use client";

import type { Turn, TurnDetail, UndoResult } from "@/lib/turn-types";

export const turnsKeys = {
  session: (sessionId: string) => ["turns", sessionId] as const,
  detail: (sessionId: string, turnNo: number) =>
    ["turns", sessionId, turnNo] as const,
};

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

const notImplemented = () => Promise.reject(new Error("Not implemented"));

// M2 contract: the shape only; U2.3 implements it

/** A session's turns (GET /api/sessions/[id]/turns) */
export function useTurns(
  _sessionId: string,
  _options: { enabled?: boolean } = {}
): UseTurns {
  return {
    turns: [],
    enabled: false,
    isLoading: false,
    detail: notImplemented,
    undo: notImplemented,
  };
}
