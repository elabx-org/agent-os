import { proxy } from "valtio";

/** The turn diff a session's ChatView has open */
export interface DiffReviewOpen {
  sessionId: string;
  turnNo: number;
}

/** What the review beside the pane calls back into the session's ChatView */
export interface DiffReviewHandlers {
  close: () => void;
  undoTurn: (turnNo: number) => void;
}

/**
 * A turn's diff review (M12) beside the pane: the open Duo's right page
 * (O-Diff) and the desktop's room beside the chat (D-Diff), so the session
 * header covers the conversation only. ChatView opens it from a turn card's
 * Diff; SessionSpread draws it where it has room and says so in `room`, and
 * ChatView draws it over itself everywhere else (closed Duo, phone, table).
 */
export const diffReviewStore = proxy<{
  open: DiffReviewOpen | null;
  /** The session SessionSpread has room beside, for the review */
  room: string | null;
}>({
  open: null,
  room: null,
});

// Kept out of the proxy: plain callbacks, not state
let handlers: DiffReviewHandlers | null = null;

export function openDiffReview(
  open: DiffReviewOpen,
  on: DiffReviewHandlers
): () => void {
  handlers = on;
  const entry = { ...open };
  diffReviewStore.open = entry;
  return () => {
    // Only its own: another ChatView may have opened one since
    if (
      diffReviewStore.open?.sessionId === entry.sessionId &&
      diffReviewStore.open.turnNo === entry.turnNo
    ) {
      diffReviewStore.open = null;
      handlers = null;
    }
  };
}

export function closeDiffReview() {
  handlers?.close();
}

export function undoReviewTurn(turnNo: number) {
  handlers?.undoTurn(turnNo);
}
