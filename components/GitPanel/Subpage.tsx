"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubpageProps {
  /** "Back to changes", "Back to history" */
  backLabel: string;
  onBack: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Controls at the header's right */
  actions?: ReactNode;
  /** Over the whole panel (narrow) rather than in D-Git's main column */
  layer?: boolean;
  /** The closed Duo's insets: 20px left, 8px before the column */
  closed?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A page within the git page: a diff, a commit, the PR's review. Over the
 * whole panel when it is narrow; D-Git's main column otherwise
 */
export function Subpage({
  backLabel,
  onBack,
  title,
  subtitle,
  actions,
  layer,
  closed,
  children,
  className,
}: SubpageProps) {
  return (
    <div
      className={cn(
        "bg-background flex min-h-0 min-w-0 flex-col",
        layer ? "absolute inset-0 z-20" : "h-full flex-1",
        className
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-none items-center gap-1.5 pt-3 pb-2",
          layer ? (closed ? "pr-2 pl-3" : "px-2") : "px-4"
        )}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="hover:bg-foreground/[0.06] flex size-[44px] flex-none items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate text-[15px] font-semibold">{title}</div>
          {subtitle && (
            <div className="text-muted-foreground truncate text-[13px]">
              {subtitle}
            </div>
          )}
        </div>
        {actions}
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-[max(1rem,var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
          layer ? (closed ? "pr-2 pl-5" : "px-3") : "px-6"
        )}
      >
        {children}
      </div>
    </div>
  );
}
