"use client";

import { useEffect } from "react";
import { MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLayoutMode } from "@/hooks/useLayoutMode";

export interface SelectionBarProps {
  /** "2 lines" */
  lines: number;
  onComment: () => void;
  onClear: () => void;
  className?: string;
}

/** Typing somewhere: the shortcuts stay out of the way */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * The floating bar over a selection: "2 lines · Comment" (D-Diff), with the
 * C shortcut on the desktop. Escape clears the selection.
 */
export function SelectionBar({
  lines,
  onComment,
  onClear,
  className,
}: SelectionBarProps) {
  const desktop = useLayoutMode() === "desktop";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClear();
      } else if (
        desktop &&
        (e.key === "c" || e.key === "C") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        onComment();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, onComment, onClear]);

  return (
    <div
      role="toolbar"
      aria-label={`${lines} ${lines === 1 ? "line" : "lines"} selected`}
      className={cn(
        "glass flex items-center gap-1 rounded-[14px] p-[5px]",
        className
      )}
    >
      <span className="text-muted-foreground pr-2 pl-1.5 text-[13px] whitespace-nowrap">
        {lines} {lines === 1 ? "line" : "lines"}
      </span>
      <button
        type="button"
        onClick={onComment}
        className="pill pill-primary pill-sm h-8 rounded-[10px] px-3"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Comment
      </button>
      {desktop ? (
        <kbd className="text-muted-foreground px-1.5 font-mono text-[13px]">
          C
        </kbd>
      ) : (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="text-muted-foreground flex h-8 w-8 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
