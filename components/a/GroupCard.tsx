"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Rows on one rounded card with hairlines between them (.group-card) */
export function GroupCard({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div aria-label={ariaLabel} className={cn("group-card", className)}>
      {children}
    </div>
  );
}

export interface GroupRowProps {
  /** An Avatar, a 30px icon tile or a StateDot */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A value or a time on the right ("Dark · Purple", "2m") */
  trailing?: ReactNode;
  /** The drill-in chevron */
  chevron?: boolean;
  /** .row.sel: the row showing beside the list (open Duo, desktop) */
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/** One .row: 56px min, 12/14 padding; a button when it has onClick */
export function GroupRow({
  leading,
  title,
  subtitle,
  trailing,
  chevron,
  selected,
  onClick,
  className,
}: GroupRowProps) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-base font-medium">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground mt-0.5 block truncate text-sm">
            {subtitle}
          </span>
        )}
      </span>
      {trailing != null && (
        <span className="text-muted-foreground flex shrink-0 items-center text-[13px]">
          {trailing}
        </span>
      )}
      {chevron && (
        <ChevronRight
          aria-hidden
          strokeWidth={2}
          className="h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]"
        />
      )}
    </>
  );
  const classes = cn(
    "row w-full",
    selected && "sel",
    onClick && "active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50",
    className
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected || undefined}
      className={classes}
    >
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}
