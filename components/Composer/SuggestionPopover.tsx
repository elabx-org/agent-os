"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AtTab, Suggestion } from "./useComposer";

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
  /** "@" only: the Files | Sessions control on top (N-Attach) */
  tab?: AtTab;
  onTab?: (tab: AtTab) => void;
  /** The Sessions tab's list (SessionSuggestions), shown in its place */
  sessions?: ReactNode;
}

const TABS: [AtTab, string][] = [
  ["files", "Files"],
  ["sessions", "Sessions"],
];

/** Claude Code's "/" commands or "@" files, filtered as you type */
export function SuggestionPopover({
  id,
  kind,
  items,
  selected,
  onHover,
  onChoose,
  tab = "files",
  onTab,
  sessions,
}: SuggestionPopoverProps) {
  const tabbed = kind === "at" && !!onTab;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, tab]);

  return (
    // E-Composer: full-width rows on the glass, hairlines between them
    <div className={cn(POPOVER, "p-0")}>
      {tabbed && (
        <div className="px-2.5 pt-2.5 pb-1.5">
          <div
            role="tablist"
            aria-label="Attach"
            className="seg bg-foreground/[0.06] grid grid-cols-2"
          >
            {TABS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                aria-pressed={tab === value}
                tabIndex={-1}
                // Keep the keyboard up: focus stays in the box
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onTab?.(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {tabbed && tab === "sessions" ? (
        sessions
      ) : (
        <div
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={kind === "slash" ? "Commands" : "Files"}
          className="max-h-[min(45vh,320px)] overflow-y-auto overscroll-contain"
        >
          {items.length === 0 && (
            <div className="text-muted-foreground flex min-h-11 items-center px-3.5 text-sm">
              No files match
            </div>
          )}
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
      )}
    </div>
  );
}
