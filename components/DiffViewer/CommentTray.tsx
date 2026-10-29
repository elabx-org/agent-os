"use client";

import type { ReviewComment } from "@/lib/review-types";

export interface CommentTrayProps {
  /** The pending comments, oldest first */
  comments: ReviewComment[];
  agentName: string;
  sending?: boolean;
  error?: string | null;
  onSend: () => void;
  onDiscard: () => void;
  /** Jump to a comment's line in the diff */
  onOpen?: (comment: ReviewComment) => void;
  onRemove?: (comment: ReviewComment) => void;
  className?: string;
}

/**
 * The desktop's tray under the diff (D-Diff): "2 comments · Discard · Send
 * to Claude", each comment's file:line and text. Hidden with no comments.
 * M12 contract stub: U12.3 implements
 */
export function CommentTray(props: CommentTrayProps) {
  void props;
  return null;
}
