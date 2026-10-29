"use client";

import { Fragment, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DiffLine, ParsedDiff } from "@/lib/diff-parser";
import type { ReviewSide } from "@/lib/review-types";
import {
  isSelected,
  sideOf,
  type LineHit,
  type ReviewLineProps,
} from "./review-selection";
import { diffBody } from "./diff-format";
import { pairRows } from "./split-rows";

export interface SplitDiffProps extends ReviewLineProps {
  diff: ParsedDiff;
  className?: string;
}

/** A selected line (O-Diff, D-Diff): purple tone, a 3px bar on the left */
export const SELECTED_LINE =
  "!bg-primary/20 !text-foreground shadow-[inset_3px_0_0_hsl(var(--meter))]";

/** The mouse drag over the gutter: which file and side it extends */
let drag: { path: string; side: ReviewSide } | null = null;

function endDrag() {
  drag = null;
  window.removeEventListener("pointerup", endDrag);
  window.removeEventListener("pointercancel", endDrag);
}

/**
 * A line's number as the tap target. A tap or click selects the line, a
 * shift-click extends; with a mouse, a drag over the gutter selects what it
 * crosses. Touch never drags (the gutter keeps scrolling the page), and the
 * text is never selected natively (WKWebView).
 */
export function ReviewGutter({
  path,
  line,
  selected,
  onLineHit,
  className,
}: {
  path: string;
  line: DiffLine;
  selected: boolean;
  onLineHit?: (hit: LineHit) => void;
  className?: string;
}) {
  // The mouse's press already selected: its click must not select again
  const pressed = useRef(false);
  const { side, line: n } = sideOf(line);
  const number = (
    <span
      className={cn(
        "inline-block w-7 shrink-0 text-right select-none",
        selected ? "text-primary dark:text-meter" : "text-[var(--code-gutter)]",
        className
      )}
    >
      {n ?? ""}
    </span>
  );
  if (!onLineHit || n === null) return number;

  const hit = (extend: boolean) =>
    onLineHit({ path, line, hunkIndex: 0, extend });

  return (
    <button
      type="button"
      aria-label={`${selected ? "Selected: line" : "Select line"} ${n}${side === "old" ? " (old)" : ""}`}
      aria-pressed={selected}
      data-review-gutter=""
      onPointerDown={(e) => {
        if (e.pointerType === "touch" || e.button !== 0) return;
        // No native text selection and no focus ring from the press
        e.preventDefault();
        pressed.current = true;
        hit(e.shiftKey);
        drag = { path, side };
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch" || !(e.buttons & 1)) return;
        if (drag?.path === path && drag.side === side) hit(true);
      }}
      onClick={(e) => {
        if (pressed.current) {
          pressed.current = false;
          return;
        }
        // A tap, or Enter/Space on the focused number
        hit(e.shiftKey);
      }}
      className="-my-px inline-flex cursor-pointer touch-manipulation py-px focus-visible:outline-none focus-visible:[&>span]:underline"
    >
      {number}
    </button>
  );
}

/**
 * One file side by side (D-Diff's Split): old numbers and lines left, new
 * right, deletions and additions paired within a hunk, blank filler rows
 * where a side has none. Long lines wrap inside their half.
 */
export function SplitDiff({
  diff,
  path,
  selection,
  onLineHit,
  renderAfter,
  className,
}: SplitDiffProps) {
  const { caption, hunks } = diffBody(diff);
  const lineClass = "whitespace-pre-wrap [overflow-wrap:anywhere]";

  const cell = (line: DiffLine | null, h: number) => {
    if (!line) return <div className="bg-foreground/[0.02]" />;
    const selected = isSelected(selection ?? null, path, line);
    return (
      <div
        className={cn(
          "flex min-w-0 gap-2 py-0 pr-3 pl-2",
          lineTone(line.type),
          selected && SELECTED_LINE
        )}
      >
        <ReviewGutter
          path={path}
          line={line}
          selected={selected}
          onLineHit={
            onLineHit && ((hit) => onLineHit({ ...hit, hunkIndex: h }))
          }
        />
        <span className={cn("min-w-0 flex-1", lineClass)}>
          {sign(line) + line.content}
        </span>
      </div>
    );
  };

  const after = (line: DiffLine | null, h: number): ReactNode =>
    line && renderAfter ? renderAfter(line, h) : null;

  return (
    <div className={cn("mini-diff w-full", className)}>
      {caption && <div className={cn("dl-ctx", lineClass)}>{caption}</div>}
      {hunks &&
        diff.hunks.map((hunk, h) => (
          <Fragment key={h}>
            <div className="dl-ctx truncate pl-[46px]">{hunk.header}</div>
            {pairRows(hunk).map((row, i) => {
              const left = after(row.left, h);
              const right = after(row.right, h);
              return (
                <Fragment key={i}>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] !px-0 !whitespace-normal">
                    {cell(row.left, h)}
                    <div className="border-l border-[var(--hair)]">
                      {cell(row.right, h)}
                    </div>
                  </div>
                  {(left || right) && (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] !px-0 !whitespace-normal">
                      <div className="min-w-0">{left}</div>
                      <div className="min-w-0">{right}</div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
    </div>
  );
}

function sign(line: DiffLine): string {
  return line.type === "addition"
    ? "+ "
    : line.type === "deletion"
      ? "- "
      : "  ";
}

function lineTone(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "dl-add";
    case "deletion":
      return "dl-del";
    default:
      return "dl-ctx";
  }
}
