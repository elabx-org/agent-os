"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { backPage } from "@/stores/workspacePage";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /** The mono line under the title: a path, a branch, a crumb */
  subtitle?: ReactNode;
  /** Buttons on the right (Start, Save, + New) */
  actions?: ReactNode;
  className?: string;
}

/**
 * A workspace page's header: back, title and its actions. fold-controls:
 * across the flat open Duo it moves right of the hinge with the buttons.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "fold-controls border-border flex min-h-[50px] shrink-0 items-center gap-2.5 border-b px-3 pt-2 pb-2",
        className
      )}
    >
      <button
        type="button"
        onClick={backPage}
        aria-label="Back"
        className="text-muted-foreground active:bg-accent hover:bg-accent relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg after:absolute after:-inset-[5px] after:content-['']"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/** What a page shows before it's built or when its subject is gone */
export function PageEmpty({ children }: { children?: ReactNode }) {
  return (
    <div className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center text-sm">
      {children}
    </div>
  );
}
