"use client";

import type { Session } from "@/lib/db";

/**
 * N-Worktree "Move to a worktree": new branch, worktree folder, "Take my
 * uncommitted changes", what happens per agent, "Move session". On a busy
 * session: "Moves when Claude finishes this turn" and Cancel until it
 * starts. Staged changes: "Unstage or commit first"
 */
export interface MoveToWorktreeSheetProps {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a move ran (not when only scheduled) */
  onMoved?: (session: Session) => void;
}

export function MoveToWorktreeSheet(_props: MoveToWorktreeSheetProps) {
  return null; // M5 U3
}

/**
 * Draws the sheet for moveSheetStore.sessionId when it is `session`
 * (stores/moveSheet.ts), like PermissionSheetHost
 */
export function MoveToWorktreeSheetHost(_props: { session: Session }) {
  return null; // M5 U3
}
