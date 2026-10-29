"use client";

import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColumnItemProps extends Omit<
  ComponentProps<"button">,
  "children"
> {
  icon: LucideIcon;
  label: string;
  /** Shown in the hover hint, e.g. "⌘1" */
  shortcut?: string;
  selected?: boolean;
  badge?: number;
  /** amber: needs you; neutral: a plain count */
  badgeTone?: "amber" | "neutral";
  /** The filled accent circle (New) */
  prominent?: boolean;
  /** Red, the icon filled: Stop */
  danger?: boolean;
  /** Where the hover hint opens: beside a column, above a bar */
  hint: "left" | "top";
  /** An on/off switch rather than a place */
  toggle?: boolean;
  /** A heavier stroke, for back's chevron */
  bold?: boolean;
  ariaLabel?: string;
}

/** The count on an item: amber with dark text for needs you */
export function ItemBadge({
  count,
  tone = "amber",
  className,
}: {
  count: number;
  tone?: "amber" | "neutral";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-[5px] text-[11px] leading-none font-bold tabular-nums",
        tone === "amber"
          ? "bg-needs text-[#1A1300]"
          : "bg-foreground/15 text-foreground",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** One 46px item of the column or the tabletop bar */
export function ColumnItem({
  icon: Icon,
  label,
  shortcut,
  selected,
  badge,
  badgeTone = "amber",
  prominent,
  danger,
  hint,
  toggle,
  bold,
  ariaLabel,
  className,
  ...button
}: ColumnItemProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-pressed={toggle ? !!selected : undefined}
      aria-current={!toggle && selected ? "page" : undefined}
      {...button}
      className={cn(
        "group text-foreground relative flex h-[46px] w-[46px] shrink-0 touch-manipulation items-center justify-center rounded-full outline-none",
        "focus-visible:ring-ring focus-visible:ring-2",
        prominent
          ? "bg-primary text-primary-foreground active:opacity-80"
          : selected
            ? "bg-black/8 dark:bg-white/16"
            : "hover:bg-black/5 active:bg-black/5 dark:hover:bg-white/8 dark:active:bg-white/8",
        danger && "text-red-500 dark:text-red-300",
        className
      )}
    >
      <Icon
        aria-hidden
        className={cn("h-5 w-5", danger && "fill-current")}
        strokeWidth={bold ? 2.3 : 1.9}
      />
      {!!badge && (
        <ItemBadge
          count={badge}
          tone={badgeTone}
          className="absolute top-0.5 right-0"
        />
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
