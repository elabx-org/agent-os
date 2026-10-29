"use client";

import type { ReactNode } from "react";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { formatShortcut, parseShortcut } from "@/lib/script-shortcuts";
import { cn } from "@/lib/utils";

/** D-Config's .fld: 44px, radius 12, the block background */
export const FIELD =
  "h-11 w-full min-w-0 rounded-xl border border-foreground/10 bg-[var(--block)] px-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:border-[hsl(var(--meter))] focus-visible:ring-[3px] focus-visible:ring-primary/25";

/** D-Config's .lbl: 13/600 grey over a field */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground mb-1.5 block text-[13px] font-semibold"
    >
      {children}
    </label>
  );
}

/** "Cmd+Shift+T" as ⌘⇧T on a Mac, Ctrl+Shift+T elsewhere; the text if unparsed */
export function shortcutLabel(text: string, mac = isMacLike()): string {
  const spec = parseShortcut(text);
  return (spec && formatShortcut(spec, mac)) || text;
}

/** The .kc chip: a script's shortcut */
export function ShortcutChip({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "border-foreground/10 text-foreground/80 inline-flex h-6 flex-none items-center rounded-md border bg-[var(--block)] px-1.5 font-mono text-[11px]",
        className
      )}
    >
      {shortcutLabel(text)}
    </kbd>
  );
}

/** The mocks' mono step list: "1  npm install" */
export function StepList({
  steps,
  className,
}: {
  steps: readonly string[];
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "rounded-[10px] bg-[var(--block)] px-2.5 py-1.5 font-mono text-[12px] leading-[1.7]",
        className
      )}
    >
      {steps.map((step, i) => (
        <li key={i} className="flex min-w-0 gap-3">
          <span aria-hidden className="text-muted-foreground/70 flex-none">
            {i + 1}
          </span>
          <span className="min-w-0 truncate">{step}</span>
        </li>
      ))}
    </ol>
  );
}
