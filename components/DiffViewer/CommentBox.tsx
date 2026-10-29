"use client";

import type { CommentFlow } from "./review-selection";
import type { LineRange } from "@/lib/review-types";

export interface CommentBoxProps {
  range: LineRange;
  flow: CommentFlow;
  /** "Claude": "Send to chat" (immediate) or "Comment" (tray) */
  agentName: string;
  busy?: boolean;
  error?: string | null;
  /** Resolves when it went (or was queued / added to the tray) */
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The comment box under the selected lines (O-Diff): "Lines 24 to 25", the
 * text, Cancel and Send to chat (Duo) or Comment (desktop: to the tray).
 * Keeps the text if the send fails. M12 contract stub: U12.2 implements
 */
export function CommentBox(props: CommentBoxProps) {
  void props;
  return null;
}
