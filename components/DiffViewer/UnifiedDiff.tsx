"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParsedDiff, DiffLine } from "@/lib/diff-parser";
import { diffBody, hunkLines, lineNumberOf, lineText } from "./diff-format";

interface UnifiedDiffProps {
  diff: ParsedDiff;
  fileName: string;
  expanded?: boolean;
  onToggle?: () => void;
  /** Wrap long lines instead of scrolling sideways, for narrow screens */
  wrap?: boolean;
  /** The file's header row (name, +N −N); off where a card draws its own */
  header?: boolean;
  /** A gutter with each line's number (the mocks have none) */
  lineNumbers?: boolean;
  /** Makes each line a button (M12's line comments) */
  onLineClick?: (line: DiffLine, hunkIndex: number) => void;
  className?: string;
}

/**
 * One file's diff on a card (Open-Changes, D-Diff): a header that folds it,
 * then its lines in the mock's green and red, each with its own sign
 */
export function UnifiedDiff({
  diff,
  fileName,
  expanded = true,
  onToggle,
  wrap = false,
  header = true,
  lineNumbers = false,
  onLineClick,
  className,
}: UnifiedDiffProps) {
  const [localExpanded, setLocalExpanded] = useState(expanded);
  const isExpanded = onToggle ? expanded : localExpanded;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setLocalExpanded(!localExpanded);
    }
  };

  const lines = (
    <DiffLines
      diff={diff}
      wrap={wrap}
      lineNumbers={lineNumbers}
      onLineClick={onLineClick}
    />
  );
  if (!header) return <div className={className}>{lines}</div>;

  return (
    <div className={cn("tools", className)}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        className="flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left text-[13px]"
      >
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono">{fileName}</span>
        {!diff.isBinary && (
          <DiffCounts added={diff.additions} removed={diff.deletions} />
        )}
      </button>
      {isExpanded && lines}
    </div>
  );
}

/** +38 −9 in mono 12px, green and red */
export function DiffCounts({
  added,
  removed,
}: {
  added: number;
  removed: number;
}) {
  return (
    <span className="flex shrink-0 gap-2">
      <span className="n-add text-xs">+{added}</span>
      {removed > 0 && <span className="n-del text-xs">−{removed}</span>}
    </span>
  );
}

interface DiffLinesProps {
  diff: ParsedDiff;
  wrap?: boolean;
  lineNumbers?: boolean;
  onLineClick?: (line: DiffLine, hunkIndex: number) => void;
}

/**
 * The lines alone: each hunk's @@ header as a context line, then its lines.
 * Unwrapped, the block scrolls sideways on its own and every line's colour
 * runs to the longest one, so the page never widens.
 */
export function DiffLines({
  diff,
  wrap = false,
  lineNumbers = false,
  onLineClick,
}: DiffLinesProps) {
  const { caption, hunks } = diffBody(diff);
  const lineClass = wrap && "whitespace-pre-wrap [overflow-wrap:anywhere]";
  const gutter = (n: number | null) =>
    lineNumbers && (
      <span className="mr-3 inline-block w-7 text-right text-[var(--code-gutter)] select-none">
        {n ?? ""}
      </span>
    );

  return (
    <div className={wrap ? undefined : "overflow-x-auto overscroll-x-contain"}>
      <div className={cn("mini-diff", wrap ? "w-full" : "w-max min-w-full")}>
        {caption && <div className={cn("dl-ctx", lineClass)}>{caption}</div>}
        {hunks &&
          diff.hunks.map((hunk, h) => (
            <Fragment key={h}>
              {/* The @@ line stays one line even when the code wraps */}
              <div className={cn("dl-ctx", wrap && "truncate")}>
                {gutter(null)}
                {hunk.header}
              </div>
              {hunkLines(hunk).map((line, i) => {
                const cls = cn(lineTone(line.type), lineClass);
                const body = (
                  <>
                    {gutter(lineNumberOf(line))}
                    {lineText(line)}
                  </>
                );
                return onLineClick ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onLineClick(line, h)}
                    className={cn(
                      cls,
                      "block w-full cursor-pointer text-left hover:shadow-[inset_3px_0_0_hsl(var(--meter))] focus-visible:shadow-[inset_3px_0_0_hsl(var(--meter))] focus-visible:outline-none"
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={i} className={cls}>
                    {body}
                  </div>
                );
              })}
            </Fragment>
          ))}
      </div>
    </div>
  );
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
