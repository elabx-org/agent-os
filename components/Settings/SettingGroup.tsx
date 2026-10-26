"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A rounded card of setting rows, solid (settings lists take no glass) */
export function SettingGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card ring-border divide-border mx-4 my-1.5 divide-y overflow-hidden rounded-[14px] ring-1",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * One line in a group: label and hint on the left, its control on the right.
 * A label element by default, so tapping the words flips the switch it
 * holds; "div" for rows with several buttons.
 */
export function SettingRow({
  label,
  hint,
  children,
  muted,
  as: Tag = "label",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  muted?: boolean;
  as?: "label" | "div";
}) {
  return (
    <Tag className="flex min-h-[50px] items-center gap-3 px-3.5 py-1.5">
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", muted && "text-muted-foreground")}>
          {label}
        </span>
        {hint && (
          <span className="text-muted-foreground block text-xs">{hint}</span>
        )}
      </span>
      {children}
    </Tag>
  );
}
