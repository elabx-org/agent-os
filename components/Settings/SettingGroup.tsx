"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A rounded card of setting rows (.group-card), solid: settings lists take
 * no glass. Its side margins follow the page (--settings-gutter-*).
 */
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
        "group-card divide-hair my-2 mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)] divide-y",
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
    <Tag className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5">
      <span className="min-w-0 flex-1">
        <span
          className={cn("block text-[15px]", muted && "text-muted-foreground")}
        >
          {label}
        </span>
        {hint && (
          <span className="text-muted-foreground block text-[13px]">
            {hint}
          </span>
        )}
      </span>
      {children}
    </Tag>
  );
}

/** The grey value and drill-in chevron at the end of a row */
export function RowValue({
  children,
  chevron = true,
  className,
}: {
  children?: ReactNode;
  chevron?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-2", className)}>
      {children && (
        <span className="text-muted-foreground max-w-[12rem] truncate text-[14px]">
          {children}
        </span>
      )}
      {chevron && <Chevron />}
    </span>
  );
}

/** The mocks' row chevron: 16px, quieter than the value */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(
        "h-4 w-4 shrink-0 fill-none stroke-[#AEAEB2] stroke-2 [stroke-linecap:round] [stroke-linejoin:round] dark:stroke-[#636366]",
        className
      )}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** The iOS switch (51×31, green when on) for the modern rows */
export function Toggle({
  checked,
  onCheckedChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-[#34C759]" : "bg-[rgba(120,120,128,.32)]"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,.25)] transition-transform",
          checked && "translate-x-5"
        )}
      />
    </button>
  );
}
