"use client";

import type { Session } from "@/lib/db";
import type { DiffScope } from "@/lib/turn-types";

export interface DiffReviewProps {
  session: Session;
  /** "Claude", "Codex": the header's sub line and the send buttons */
  agentName: string;
  /** Where it opens: the turn card's Diff gives turn:N */
  initialScope: DiffScope;
  /**
   * "page": the open Duo's / desktop's right page beside the chat (O-Diff,
   * D-Diff); "screen": full screen over the chat (closed Duo, phone, one
   * file at a time with the "1 of 3 files" picker)
   */
  placement: "page" | "screen";
  onClose: () => void;
  /** Undo turn N in the header: opens M2's UndoSheet */
  onUndoTurn?: (turnNo: number) => void;
  className?: string;
}

/**
 * The diff review (O-Diff, D-Diff): header "Turn N · 3 files · 4m ago ·
 * Claude" with +N −N and Undo turn N, the scope segment This turn / Branch /
 * Uncommitted, Unified/Split on the desktop, file cards with gutter line
 * selection, the floating "2 lines · Comment" bar, the comment box, sent and
 * pending markers on lines, and the desktop's CommentTray.
 * M12 contract stub: U12.2 implements
 */
export function DiffReview(props: DiffReviewProps) {
  void props;
  return null;
}
