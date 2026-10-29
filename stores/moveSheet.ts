import { proxy } from "valtio";

/**
 * N-Worktree: the session whose "Move to a worktree" sheet is up. The
 * header ⋯ and the Project page's row actions open it; a
 * MoveToWorktreeSheetHost draws it.
 */
export const moveSheetStore = proxy<{
  sessionId: string | null;
  /**
   * The focused pane's session when it can move: the column's ⋯ offers
   * it there (the page and large headers have no ⋯ of their own)
   */
  offer: string | null;
}>({
  sessionId: null,
  offer: null,
});

export function openMoveSheet(sessionId: string): void {
  moveSheetStore.sessionId = sessionId;
}

export function closeMoveSheet(): void {
  moveSheetStore.sessionId = null;
}
