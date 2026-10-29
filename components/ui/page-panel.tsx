"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageEdge } from "./page-edge";

/**
 * A panel on the open Duo's right page (Live, Changes): a handle on its fold
 * side drags it away to the right, past a third (or a flick) closes it. A
 * tap on the handle closes it too.
 */
export function PagePanel({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative flex min-h-0", className)}>
      {onClose && <PageEdge label={`Close ${label}`} onClose={onClose} />}
      {children}
    </div>
  );
}

/** The × in a right-page panel's header */
export function PanelClose({
  label,
  onClose,
  className,
}: {
  label: string;
  onClose: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Close ${label}`}
      onClick={onClose}
      className={cn(
        "bg-foreground/10 text-foreground hover:bg-foreground/15 -my-1 grid h-8 w-8 shrink-0 place-items-center rounded-full",
        className
      )}
    >
      <X className="h-4 w-4" strokeWidth={2.4} />
    </button>
  );
}
