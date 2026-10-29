/**
 * Line selection in a diff review (M12): explicit gutter taps, never native
 * text selection (WKWebView). A tap picks a line, a second tap or a
 * shift-click on the same file and side extends it to a range, a drag over
 * the gutter selects what it crosses. Pure: unit-tested.
 */

import type { ReactNode } from "react";
import type { DiffLine, ParsedDiff } from "@/lib/diff-parser";
import type { LayoutMode } from "@/hooks/useLayoutMode";
import type { LineRange, ReviewSide } from "@/lib/review-types";
import { hunkLines } from "./diff-format";

/** A gutter hit: the line and where it is */
export interface LineHit {
  path: string;
  line: DiffLine;
  hunkIndex: number;
  /** Shift held (desktop), or a second tap that should extend */
  extend?: boolean;
}

/** The current selection: a range plus the line the user started from */
export interface LineSelection extends LineRange {
  anchor: number;
}

/**
 * A line's side and number: deletions are the old file's, the rest the new
 * one's. A context line with no new number (SplitDiff's left column passes
 * it so) counts as the old file's. Header lines have no number.
 */
export function sideOf(line: DiffLine): {
  side: ReviewSide;
  line: number | null;
} {
  if (line.type === "header") return { side: "new", line: null };
  if (line.type === "deletion")
    return { side: "old", line: line.oldLineNumber };
  if (line.newLineNumber === null && line.oldLineNumber !== null)
    return { side: "old", line: line.oldLineNumber };
  return { side: "new", line: line.newLineNumber };
}

/**
 * The selection after a hit: a new single line, or (extend, same path and
 * side) the range from the anchor to the hit. Header lines select nothing.
 */
export function nextSelection(
  prev: LineSelection | null,
  hit: LineHit
): LineSelection | null {
  const { side, line } = sideOf(hit.line);
  if (line === null) return prev;
  if (hit.extend && prev && prev.path === hit.path && prev.side === side)
    return {
      path: prev.path,
      side,
      startLine: Math.min(prev.anchor, line),
      endLine: Math.max(prev.anchor, line),
      anchor: prev.anchor,
    };
  return { path: hit.path, side, startLine: line, endLine: line, anchor: line };
}

/**
 * A gutter tap as DiffReview reads it: a tap on the only selected line
 * clears it; on touch, a second tap on the same file and side extends the
 * single selected line to a range (no shift key there); otherwise as
 * nextSelection
 */
export function tapSelection(
  prev: LineSelection | null,
  hit: LineHit,
  touch: boolean
): LineSelection | null {
  const { side, line } = sideOf(hit.line);
  const single =
    !!prev &&
    prev.path === hit.path &&
    prev.side === side &&
    prev.startLine === prev.endLine;
  if (!hit.extend && single && line === prev!.startLine) return null;
  if (!hit.extend && touch && single)
    return nextSelection(prev, { ...hit, extend: true });
  return nextSelection(prev, hit);
}

/** The range alone, without the anchor (what a comment stores) */
export function rangeOf(sel: LineSelection): LineRange {
  return {
    path: sel.path,
    side: sel.side,
    startLine: sel.startLine,
    endLine: sel.endLine,
  };
}

/** Whether a rendered line is inside the selection */
export function isSelected(
  sel: LineSelection | null,
  path: string,
  line: DiffLine
): boolean {
  if (!sel || sel.path !== path) return false;
  const at = sideOf(line);
  return (
    at.line !== null &&
    at.side === sel.side &&
    at.line >= sel.startLine &&
    at.line <= sel.endLine
  );
}

/**
 * The selected lines' text from the diff (the comment's quote), in diff
 * order, without the +/- signs: on the new side the additions and context
 * lines, on the old side the deletions and context lines
 */
export function quoteOf(diff: ParsedDiff, range: LineRange): string {
  const out: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunkLines(hunk)) {
      const n =
        range.side === "old"
          ? line.type === "addition"
            ? null
            : line.oldLineNumber
          : line.type === "deletion"
            ? null
            : line.newLineNumber;
      if (n !== null && n >= range.startLine && n <= range.endLine)
        out.push(line.content);
    }
  }
  return out.join("\n");
}

/** How many lines (the bar's "2 lines") */
export function lineCount(range: LineRange): number {
  return range.endLine - range.startLine + 1;
}

/**
 * How a comment goes: the Duo and the phone send each one at once ("Send to
 * chat"); the desktop collects them in the tray ("Send to Claude")
 */
export type CommentFlow = "immediate" | "tray";

export function commentFlow(mode: LayoutMode): CommentFlow {
  return mode === "desktop" ? "tray" : "immediate";
}

/** Unified on phones and Duos; the desktop picks (Unified | Split) */
export type DiffLayout = "unified" | "split";

/**
 * What DiffLines and SplitDiff take for review (U12.2 adds these props to
 * DiffLines/FileDiffCard): selection highlight, gutter hits, and rows drawn
 * after a line (comment markers, the comment box)
 */
export interface ReviewLineProps {
  path: string;
  selection?: LineSelection | null;
  onLineHit?: (hit: LineHit) => void;
  /** Rendered under the line, full width ("Sent · …", the comment box) */
  renderAfter?: (line: DiffLine, hunkIndex: number) => ReactNode;
}
