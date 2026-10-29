"use client";

import { Check, ChevronDown, EyeOff } from "lucide-react";
import type { Session } from "@/lib/db";
import { setFocus } from "@/stores/focus";
import { BesideItems } from "@/components/BesideItems";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LiveActivity } from "./LiveActivity";

/**
 * The live activity rail beside the session (Desk-Chat, the open Duo's
 * right page): LiveActivity with a menu to put another session there
 * instead, or hide it. `compact` is the sheet's body, which brings its own
 * title; `onNavigate` runs after anything that leaves the rail, so the
 * sheet can close.
 */
export function ActivityRail({
  session,
  active = true,
  compact,
  onNavigate,
  onClose,
  className,
}: {
  session: Session;
  active?: boolean;
  compact?: boolean;
  onNavigate?: () => void;
  /** The open Duo's right page: a × and Close instead of Hide */
  onClose?: () => void;
  className?: string;
}) {
  if (compact)
    return (
      <LiveActivity
        session={session}
        active={active}
        variant="sheet"
        onNavigate={onNavigate}
        className={className}
      />
    );
  return (
    <LiveActivity
      session={session}
      active={active}
      variant="rail"
      onNavigate={onNavigate}
      onClose={onClose}
      className={className}
      menu={
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Live activity options"
              className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground -ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
            >
              <ChevronDown aria-hidden className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            <DropdownMenuItem disabled>
              <Check className="h-4 w-4" />
              Live activity
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <BesideItems exclude={[session.id]} />
            <DropdownMenuSeparator />
            {/* The pane takes both pages (or the width): Focus */}
            <DropdownMenuItem onSelect={onClose ?? (() => setFocus(true))}>
              <EyeOff className="h-4 w-4" />
              {onClose ? "Close" : "Hide"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}
