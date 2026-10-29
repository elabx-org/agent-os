/**
 * How line comments read: "DeckStateLine.tsx:22" or ":24-25" labels, and the
 * one message that sends them (each as a quote, ReplyContext's Markdown
 * blockquote format, then its comment). Pure: shared by server and client.
 */

import type { LineRange, ReviewComment } from "./review-types";

/** "DeckStateLine.tsx:22", "DeckStateLine.tsx:24-25" (file name, not path) */
export function rangeLabel(range: LineRange): string {
  void range;
  throw new Error("M12 contract stub: rangeLabel");
}

/** "Lines 24 to 25", "Line 22" (the comment box's caption) */
export function linesCaption(range: LineRange): string {
  void range;
  throw new Error("M12 contract stub: linesCaption");
}

/**
 * The message for one or more comments, in the order given: per comment its
 * path:lines label, the quoted lines (formatWithQuotes) and the body
 */
export function formatReviewMessage(
  comments: readonly Pick<
    ReviewComment,
    "path" | "side" | "startLine" | "endLine" | "quote" | "body"
  >[]
): string {
  void comments;
  throw new Error("M12 contract stub: formatReviewMessage");
}
