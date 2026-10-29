"use client";

import type { ReactNode } from "react";
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
  // Contract stub: U1.3 finishes the type and the chevron
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground mt-0.5 block truncate text-sm">
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
      {chevron && <span aria-hidden>›</span>}
    </>
  );
  const classes = cn("row w-full", selected && "sel", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}
