"use client";

import type { HitRanges } from "@/lib/search/types";

/**
 * Text with its matches marked (the mocks' `.hit`: accent text on a faint
 * accent tint). Owned by U11.3
 */
export function Highlight({
  text,
  ranges,
  className,
}: {
  text: string;
  ranges: HitRanges;
  className?: string;
}) {
  void ranges;
  return <span className={className}>{text}</span>;
}
