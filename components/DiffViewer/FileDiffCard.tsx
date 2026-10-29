"use client";

import type { ReactNode } from "react";
import type { DiffLine, ParsedDiff } from "@/lib/diff-parser";
import type { GitBadge } from "@/lib/git-types";
import { UnifiedDiff } from "./UnifiedDiff";

export interface FileDiffCardProps {
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
  expanded,
  defaultExpanded = true,
  onToggle,
  wrap,
}: FileDiffCardProps) {
  // M2b contract stub: U2b.4 builds the card
  return (
    <UnifiedDiff
      diff={diff}
      fileName={path}
      expanded={expanded ?? defaultExpanded}
      onToggle={onToggle ? () => onToggle(!(expanded ?? true)) : undefined}
      wrap={wrap}
    />
  );
}
