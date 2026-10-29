"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Suggestion } from "./useComposer";

/** Glass-like, as the + menu; ComposerPopover places it */
export const POPOVER = "glass overflow-hidden rounded-[20px] p-1.5";

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
    // E-Composer: full-width rows on the glass, hairlines between them
    <div className={cn(POPOVER, "p-0")}>
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
                "flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm",
                i > 0 && !item.group && "border-t border-[var(--hair)]",
                i === selected ? "bg-primary/18" : "active:bg-muted"
              )}
            >
              <code
                className={cn(
                  "font-mono text-sm",
                  i === selected
                    ? "text-[#6D28D9] dark:text-[#C4B5FD]"
                    : "text-foreground",
                  kind === "at"
                    ? "min-w-0 flex-1 truncate text-left [direction:rtl]"
                    : "min-w-[84px] shrink-0"
                )}
              >
                {/* rtl keeps a long path's file name in view */}
                {kind === "at" ? <bdi>{item.label}</bdi> : item.label}
              </code>
              <span
                className={cn(
                  "text-muted-foreground truncate",
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
