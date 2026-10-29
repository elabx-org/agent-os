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

/** A line's side and number: deletions are the old file's, the rest the new one's */
export function sideOf(line: DiffLine): {
  side: ReviewSide;
  line: number | null;
} {
  void line;
  throw new Error("M12 contract stub: sideOf");
}

/**
 * The selection after a hit: a new single line, or (extend, same path and
 * side) the range from the anchor to the hit. Header lines select nothing.
 */
export function nextSelection(
  prev: LineSelection | null,
  hit: LineHit
): LineSelection | null {
  void prev;
  void hit;
  throw new Error("M12 contract stub: nextSelection");
}

/** Whether a rendered line is inside the selection */
export function isSelected(
  sel: LineSelection | null,
  path: string,
  line: DiffLine
): boolean {
  void sel;
  void path;
  void line;
  throw new Error("M12 contract stub: isSelected");
}

/** The selected lines' text from the diff (the comment's quote) */
export function quoteOf(diff: ParsedDiff, range: LineRange): string {
  void diff;
  void range;
  throw new Error("M12 contract stub: quoteOf");
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
