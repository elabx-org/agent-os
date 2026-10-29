"use client";

import type { HitRanges } from "@/lib/search/types";
import { highlightParts } from "./palette-model";

/** The mocks' `.hit`: accent text, semibold, on a faint accent tint */
export const HIT_CLASS =
  "rounded px-0.5 font-semibold text-[#6D28D9] dark:text-[#C4B5FD] bg-primary/[0.22]";

/** Text with its matches marked */
export function Highlight({
  text,
  ranges,
  className,
}: {
  text: string;
  ranges: HitRanges;
  className?: string;
}) {
  return (
    <span className={className}>
      {highlightParts(text, ranges).map((part, i) =>
        part.hit ? (
          <mark key={i} className={HIT_CLASS}>
            {part.text}
          </mark>
        ) : (
          part.text
        )
      )}
    </span>
  );
}
