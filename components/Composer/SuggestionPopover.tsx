"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Suggestion } from "./useComposer";

/** Glass-like, as the + menu; ComposerPopover places it */
export const POPOVER =
  "bg-background/70 border-border overflow-hidden rounded-2xl border p-1.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08),0_12px_30px_rgb(0_0_0/0.35)] backdrop-blur-xl backdrop-saturate-150";

export const GROUP_HEADING =
  "text-muted-foreground/80 px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase";

interface SuggestionPopoverProps {
  /** The composer box points at it (aria-controls) and its options */
  id: string;
  kind: "slash" | "at";
  items: Suggestion[];
  selected: number;
  onHover: (index: number) => void;
  onChoose: (item: Suggestion) => void;
}

/** Claude Code's "/" commands or "@" files, filtered as you type */
export function SuggestionPopover({
  id,
  kind,
  items,
  selected,
  onHover,
  onChoose,
}: SuggestionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className={POPOVER}>
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={kind === "slash" ? "Commands" : "Files"}
        className="max-h-[min(45vh,320px)] overflow-y-auto overscroll-contain"
      >
        {items.map((item, i) => (
          <div key={item.key}>
            {item.group && <div className={GROUP_HEADING}>{item.group}</div>}
            <button
              type="button"
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              tabIndex={-1}
              data-index={i}
              // Keep the keyboard up: focus stays in the box
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onChoose(item)}
              className={cn(
                "flex min-h-9 w-full items-baseline gap-2 rounded-[10px] px-2.5 py-1.5 text-left pointer-coarse:min-h-11 pointer-coarse:py-3",
                i === selected ? "bg-muted" : "active:bg-muted"
              )}
            >
              <code
                className={cn(
                  "text-foreground font-mono text-[13px]",
                  kind === "at"
                    ? "min-w-0 flex-1 truncate text-left [direction:rtl]"
                    : "shrink-0"
                )}
              >
                {/* rtl keeps a long path's file name in view */}
                {kind === "at" ? <bdi>{item.label}</bdi> : item.label}
              </code>
              <span
                className={cn(
                  "text-muted-foreground truncate text-xs",
                  kind === "at" ? "shrink-0" : "min-w-0 flex-1"
                )}
              >
                {item.detail}
              </span>
              {item.hint && (
                <em className="text-muted-foreground/70 shrink-0 text-[10px] not-italic">
                  {item.hint}
                </em>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
