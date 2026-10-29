/**
 * How line comments read: "DeckStateLine.tsx:22" or ":24-25" labels, and the
 * one message that sends them (each as a quote, ReplyContext's Markdown
 * blockquote format, then its comment). Pure: shared by server and client.
 */

import type { LineRange, ReviewComment } from "./review-types";

const lines = (range: LineRange) =>
  range.startLine === range.endLine
    ? `${range.startLine}`
    : `${range.startLine}-${range.endLine}`;

/** "DeckStateLine.tsx:22", "DeckStateLine.tsx:24-25" (file name, not path) */
export function rangeLabel(range: LineRange): string {
  const name = range.path.split("/").filter(Boolean).pop() ?? range.path;
  return `${name}:${lines(range)}`;
}

/** "Lines 24 to 25", "Line 22" (the comment box's caption) */
export function linesCaption(range: LineRange): string {
  return range.startLine === range.endLine
    ? `Line ${range.startLine}`
    : `Lines ${range.startLine} to ${range.endLine}`;
}

/**
 * The quoted lines as a Markdown blockquote: stores/replyQuotes.ts
 * formatWithQuotes's format ("> " per line, ">" for a blank one), kept here
 * because that module pulls in valtio's React hooks
 */
function blockquote(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+|\s+$/g, "")
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
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
  return comments
    .map((c) => {
      // The full repo path, so the agent can open the file; old-side lines
      // are the deleted ones, numbered as before the change
      const label = `${c.path}:${lines(c)}${c.side === "old" ? " (removed lines)" : ""}`;
      const quote = c.quote.trim() ? `\n${blockquote(c.quote)}` : "";
      // A blank line after the quote, else Markdown reads the body into it
      return `${label}${quote}\n\n${c.body.trim()}`;
    })
    .join("\n\n");
}
