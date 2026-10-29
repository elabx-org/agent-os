"use client";

import type {
  CancelMoveResult,
  MovePreview,
  MoveRequest,
  MoveResult,
  MoveState,
} from "@/lib/worktree-move-types";

/**
 * The "Move to a worktree" sheet's data and actions (M5, N-Worktree).
 * Actions go through fetchAsUser (user-only routes) and refresh the
 * sessions list and the moves list; they throw with the route's refusal
 * text.
 */
export interface UseWorktreeMove {
  /** GET move-to-worktree/preview while `open`; null until loaded */
  preview: MovePreview | null;
  loading: boolean;
  move: (request: MoveRequest) => Promise<MoveResult>;
  /** Cancels the scheduled move */
  cancel: () => Promise<CancelMoveResult>;
}

export function useWorktreeMove(
  _sessionId: string,
  _open: boolean
): UseWorktreeMove {
  const notYet = () => Promise.reject(new Error("Not implemented")); // M5 U3
  return { preview: null, loading: false, move: notYet, cancel: notYet };
}

/**
 * Every scheduled, running or failed move by session id (GET
 * /api/worktree-moves through useSharedPoll), for Now's "Moving…"
 */
export function useWorktreeMoves(): Record<string, MoveState> {
  return {}; // M5 U3
}
