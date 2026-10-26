"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColumnItemProps {
  icon: LucideIcon;
  label: string;
  /** Shown in the hover hint, e.g. "⌘1" */
  shortcut?: string;
  selected?: boolean;
  badge?: number;
  /** alert: needs you (red); neutral: a plain count */
  badgeTone?: "alert" | "neutral";
  /** Small amber dot, for Focus while something needs you */
  dot?: boolean;
  /** Where the hover hint opens: beside a column, above a bar */
  hint: "left" | "top";
  /** An on/off switch (Focus) rather than a place */
  toggle?: boolean;
  ariaLabel?: string;
  className?: string;
  onClick: () => void;
}

export function ColumnItem({
  icon: Icon,
  label,
  shortcut,
  selected,
  badge,
  badgeTone = "alert",
  dot,
  hint,
  toggle,
  ariaLabel,
  className,
  onClick,
}: ColumnItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-pressed={toggle ? !!selected : undefined}
      aria-current={!toggle && selected ? "page" : undefined}
      className={cn(
        "group relative flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full outline-none",
        "focus-visible:ring-ring focus-visible:ring-2",
        selected
          ? "bg-accent text-foreground"
          : "text-foreground/75 hover:bg-accent/60 hover:text-foreground active:bg-accent/60",
        className
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={selected ? 2.4 : 1.8} />
      {!!badge && (
        <span
          className={cn(
            "absolute top-0.5 right-0.5 h-4 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold tabular-nums",
            badgeTone === "alert"
              ? "bg-red-500 text-white"
              : "bg-muted text-foreground"
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {dot && (
        <span className="ring-background absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-400 ring-2" />
      )}
      {/* Hints are for a mouse: a touch never shows them */}
      <span
        aria-hidden
        className={cn(
          "bg-popover text-popover-foreground border-border pointer-events-none absolute z-10 hidden items-center gap-1.5 rounded-lg border px-2 py-1 text-xs whitespace-nowrap shadow-md",
          "pointer-fine:group-hover:flex pointer-fine:group-focus-visible:flex",
          hint === "left"
            ? "top-1/2 right-full mr-2 -translate-y-1/2"
            : "bottom-full left-1/2 mb-2 -translate-x-1/2"
        )}
      >
        {label}
        {shortcut && (
          <kbd className="border-border text-muted-foreground rounded border px-1 font-mono text-[11px]">
            {shortcut}
          </kbd>
        )}
      </span>
    </button>
  );
}
