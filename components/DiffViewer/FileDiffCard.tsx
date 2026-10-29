"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiffLine, ParsedDiff } from "@/lib/diff-parser";
import { gitBadgeClass, type GitBadge } from "@/lib/git-types";
import { DiffCounts, DiffLines } from "./UnifiedDiff";
import { splitPath } from "./diff-format";
import { SplitDiff } from "./SplitDiff";
import type { DiffLayout, ReviewLineProps } from "./review-selection";

export interface FileDiffCardProps extends Omit<
  Partial<ReviewLineProps>,
  "path"
> {
  /** One file's parsed diff */
  diff: ParsedDiff;
  /** Repo-relative path: the header shows its name, the folder under it */
  path: string;
  badge?: GitBadge;
  /** Controlled when set; otherwise starts open as `defaultExpanded` */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  /** Wrap long lines instead of scrolling sideways (narrow pages) */
  wrap?: boolean;
  /** Controls at the header's right (M12 puts its comment count here) */
  actions?: ReactNode;
  /** A tap on a line, for M12's line comments; lines are not tappable without it */
  onLineClick?: (line: DiffLine, hunkIndex: number) => void;
  /** M12's desktop review: side by side (SplitDiff) instead of unified */
  layout?: DiffLayout;
  className?: string;
}

/**
 * One file of a diff on its own collapsible card (Open-Changes, D-Diff):
 * badge, name and folder, +N −N, then the lines. Used by the git page, the
 * open Duo's Changes page and M12's review.
 */
export function FileDiffCard({
  diff,
  path,
  badge,
  expanded,
  defaultExpanded = true,
  onToggle,
  wrap,
  actions,
  onLineClick,
  selection,
  onLineHit,
  renderAfter,
  layout = "unified",
  className,
}: FileDiffCardProps) {
  const [ownExpanded, setOwnExpanded] = useState(defaultExpanded);
  const open = expanded ?? ownExpanded;
  const { name, folder } = splitPath(path);

  const toggle = () => {
    if (expanded === undefined) setOwnExpanded(!open);
    onToggle?.(!open);
  };

  return (
    <div className={cn("tools", className)}>
      <div className="flex min-h-12 items-center gap-2.5 pr-3.5">
        {/* The header's button holds the name; actions stay outside it */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={path}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-3.5 text-left"
        >
          {badge ? (
            <span
              className={cn("git-letter", gitBadgeClass(badge))}
              aria-label={BADGE_LABEL[badge]}
            >
              {badge}
            </span>
          ) : (
            <File
              className="text-muted-foreground h-4 w-4 shrink-0"
              aria-hidden="true"
            />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-[13px]">{name}</span>
            {folder && (
              <span className="text-muted-foreground truncate text-[13px]">
                {folder}
              </span>
            )}
          </span>
          {!diff.isBinary && (
            <DiffCounts added={diff.additions} removed={diff.deletions} />
          )}
        </button>
        {actions}
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? `Fold ${name}` : `Unfold ${name}`}
          tabIndex={-1}
          className="text-muted-foreground -mr-1 flex h-8 w-8 shrink-0 items-center justify-center"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </div>
      {open &&
        (layout === "split" ? (
          <SplitDiff
            diff={diff}
            path={path}
            selection={selection}
            onLineHit={onLineHit}
            renderAfter={renderAfter}
          />
        ) : (
          <DiffLines
            diff={diff}
            wrap={wrap}
            onLineClick={onLineClick}
            path={path}
            selection={selection}
            onLineHit={onLineHit}
            renderAfter={renderAfter}
          />
        ))}
    </div>
  );
}

const BADGE_LABEL: Record<GitBadge, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  "?": "Untracked",
};
