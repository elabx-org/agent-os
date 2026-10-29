"use client";

import type { ParsedDiff } from "@/lib/diff-parser";
import type { ReviewLineProps } from "./review-selection";

export interface SplitDiffProps extends ReviewLineProps {
  diff: ParsedDiff;
  className?: string;
}

/**
 * One file side by side (D-Diff's Split): old numbers and lines left, new
 * right, deletions and additions paired within a hunk, blank filler rows
 * where a side has none. M12 contract stub: U12.2 implements
 */
export function SplitDiff(props: SplitDiffProps) {
  void props;
  return null;
}
