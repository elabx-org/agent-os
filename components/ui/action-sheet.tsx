"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface SheetAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** A tick for the current choice in a list of options */
  checked?: boolean;
  /** Opens a second page of actions, with a way back */
  submenu?: { title: string; groups: SheetAction[][] };
}

interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Rows in rounded groups, top to bottom */
  groups: SheetAction[][];
}

// How long the sheet takes to slide away, if vaul doesn't report it
const CLOSE_FALLBACK_MS = 600;

/**
 * The touch version of a ⋯ menu: actions in grouped rows on a bottom sheet.
 * An action runs once the sheet has closed, so dialogs, prompts and focus
 * changes it starts don't fight the sheet's exit.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  groups,
}: ActionSheetProps) {
  const [page, setPage] = React.useState<SheetAction["submenu"]>();
  const pending = React.useRef<(() => void) | null>(null);
  const fallback = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const runPending = () => {
    clearTimeout(fallback.current);
    const run = pending.current;
    pending.current = null;
    run?.();
  };

  const choose = (action: SheetAction) => {
    if (action.disabled) return;
    if (action.submenu) {
      haptic("selection");
      setPage(action.submenu);
      return;
    }
    haptic(action.destructive ? "warning" : "selection");
    pending.current = action.onSelect ?? null;
    fallback.current = setTimeout(runPending, CLOSE_FALLBACK_MS);
    onOpenChange(false);
  };

  React.useEffect(() => {
    if (!open) return;
    setPage(undefined);
  }, [open]);

  React.useEffect(() => () => clearTimeout(fallback.current), []);

  const shown = page?.groups ?? groups;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onAnimationEnd={(isOpen) => {
        if (!isOpen) runPending();
      }}
    >
      <SheetContent>
        <SheetHeader className="flex-row items-center gap-1">
          {page && (
            <button
              type="button"
              onClick={() => setPage(undefined)}
              aria-label="Back"
              className="text-primary active:bg-accent -ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0">
            <SheetTitle className="truncate">{page?.title ?? title}</SheetTitle>
            {description && !page ? (
              <SheetDescription className="truncate">
                {description}
              </SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Actions</SheetDescription>
            )}
          </div>
        </SheetHeader>
        <SheetBody className="space-y-3 pb-1">
          {shown
            .filter((group) => group.length > 0)
            .map((group, i) => (
              <ul
                key={i}
                className="bg-secondary/70 divide-border/60 divide-y overflow-hidden rounded-2xl"
              >
                {group.map((action) => (
                  <li key={action.label}>
                    <button
                      type="button"
                      disabled={action.disabled}
                      onClick={() => choose(action)}
                      className={cn(
                        "active:bg-accent flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] disabled:opacity-40",
                        action.destructive && "text-red-500"
                      )}
                    >
                      {action.icon && (
                        <action.icon
                          className={cn(
                            "h-5 w-5 shrink-0",
                            !action.destructive && "text-muted-foreground"
                          )}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {action.label}
                      </span>
                      {action.checked && (
                        <Check className="text-primary h-5 w-5 shrink-0" />
                      )}
                      {action.submenu && (
                        <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
