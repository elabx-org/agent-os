"use client";

import { useDensity } from "@/hooks/useDensity";

/** A− / A+ for the current display; each display remembers its own size */
export function TextSizeControl() {
  const { offset, smaller, larger, canShrink, canGrow } = useDensity();

  const buttonClass =
    "text-muted-foreground active:bg-accent hover:bg-accent flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 disabled:opacity-40";

  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">Text size</span>
      <div
        className="flex items-center gap-0.5"
        role="group"
        aria-label="Text size for this display"
      >
        <button
          type="button"
          onClick={smaller}
          disabled={!canShrink}
          className={buttonClass}
          aria-label="Smaller text"
        >
          <span className="text-[11px] font-semibold">A</span>
        </button>
        <span className="text-muted-foreground w-6 text-center text-[11px] tabular-nums">
          {offset > 0 ? `+${offset}` : offset}
        </span>
        <button
          type="button"
          onClick={larger}
          disabled={!canGrow}
          className={buttonClass}
          aria-label="Larger text"
        >
          <span className="text-[15px] font-semibold">A</span>
        </button>
      </div>
    </div>
  );
}
