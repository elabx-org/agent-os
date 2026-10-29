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
 * Each comment's first line. It always starts with the fixed words, never
 * the raw path: a file the agent named "!cmd" or "#note" must not become
 * the first characters of a message the user sends (Claude Code reads a
 * leading ! as bash mode and # as memory)
 */
function header(
  c: Pick<ReviewComment, "path" | "side" | "startLine" | "endLine">
): string {
  const ref = `${c.path}:${lines(c)}`;
  // A backtick in the name: a longer fence, so the code span still holds
  const code = ref.includes("`") ? `\`\` ${ref} \`\`` : `\`${ref}\``;
  return `Comment on ${code}${c.side === "old" ? " (removed lines)" : ""}:`;
}

/**
 * The message for one or more comments, in the order given: per comment a
 * "Comment on `path:lines`:" line, the quoted lines (formatWithQuotes) and
 * the body
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
      const quote = c.quote.trim() ? `\n${blockquote(c.quote)}` : "";
      // A blank line after the quote, else Markdown reads the body into it
      return `${header(c)}${quote}\n\n${c.body.trim()}`;
    })
    .join("\n\n");
}

/** One comment read back out of a sent message (the chat's bubble) */
export interface SentReviewComment extends LineRange {
  body: string;
}

const HEADER = /^Comment on (?:`([^`]+)`|`` (.+) ``)( \(removed lines\))?:$/;

/**
 * A review message (formatReviewMessage) back into its comments, for the
 * chat to draw each as a quote card; null for any other message
 */
export function parseReviewMessage(text: string): SentReviewComment[] | null {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  const out: SentReviewComment[] = [];
  let body: string[] | null = null;
  const close = () => {
    if (body && out.length) out[out.length - 1].body = body.join("\n").trim();
  };
  for (const row of rows) {
    const m = row.match(HEADER);
    const ref = m && (m[1] ?? m[2]).match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (ref) {
      close();
      const startLine = Number(ref[2]);
      out.push({
        path: ref[1],
        side: m![3] ? "old" : "new",
        startLine,
        endLine: ref[3] ? Number(ref[3]) : startLine,
        body: "",
      });
      body = [];
      continue;
    }
    // Not one of ours: it has to start with a comment
    if (!body) return null;
    // The quote under the header (the card shows the label, not the code)
    if (!body.length && (row === ">" || row.startsWith("> "))) continue;
    body.push(row);
  }
  close();
  return out.length && out.every((c) => c.body) ? out : null;
}
