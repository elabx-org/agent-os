"use client";

import { useEffect, useRef } from "react";
import { Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { haptic } from "@/lib/haptics";
import {
  permissionModeKeys,
  usePermissionMode,
} from "@/hooks/usePermissionMode";
import { useClaudeState } from "@/hooks/useClaudeState";
import { mobileNavStore } from "@/stores/mobileNav";
import { openPermissionSheet } from "@/stores/permissionSheet";
import {
  chipModel,
  hasPermissionModes,
  type ChipModel,
} from "./permission-chip-model";

export interface PermissionChipProps {
  session: Session;
  /**
   * header: N-PermMode's 44px shield pill beside the title (violet while a
   * mode is set, the pending mode with a dot while it waits for the turn);
   * composer: the composer card's mode pill, same tap
   */
  variant: "header" | "composer";
  className?: string;
}

// N-PermMode's violet (its dark values as given, violet-700 in light), and
// Full access in red
const TONE = {
  set: "border-violet-500/40 bg-violet-600/10 text-violet-700 dark:border-[rgba(167,139,250,.5)] dark:bg-[rgba(124,58,237,.16)] dark:text-[#C4B5FD]",
  danger:
    "border-red-500/40 bg-red-500/10 text-red-700 dark:border-[#FF6B80]/50 dark:bg-[#FF6B80]/12 dark:text-[#FF8A9A]",
} as const;

/**
 * What a session's shield chip shows (null while it loads, and for an agent
 * with no modes), kept fresh as Claude's own mode or the session's state
 * changes: Shift+Tab in its terminal changes the mode without us (the
 * hooks' record says so), and a waiting mode is applied as a turn ends
 */
export function usePermissionChip(session: Session): ChipModel | null {
  const enabled = hasPermissionModes(session.agent_type);
  const { state } = usePermissionMode(session.id, { enabled });
  const claude = enabled && session.agent_type === "claude";
  const liveMode = useClaudeState(claude ? session.id : null).mode;
  const status = useSnapshot(mobileNavStore).statuses[session.id]?.status;
  const queryClient = useQueryClient();
  const seen = useRef(`${liveMode}|${status}`);
  useEffect(() => {
    const key = `${liveMode}|${status}`;
    if (!enabled || seen.current === key) return;
    seen.current = key;
    queryClient.invalidateQueries({
      queryKey: permissionModeKeys.session(session.id),
    });
  }, [enabled, liveMode, status, queryClient, session.id]);
  const chip = chipModel(state, session.agent_type);
  // The applier presses a waiting mode in just after the turn's end, which
  // changes neither of those (Shift+Tab fires no hook): look again until
  // it's in
  const waiting = !!chip?.pending;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(
      () =>
        queryClient.invalidateQueries({
          queryKey: permissionModeKeys.session(session.id),
        }),
      4000
    );
    return () => clearInterval(timer);
  }, [waiting, queryClient, session.id]);
  return chip;
}

/**
 * The shield chip: the session's permission mode (usePermissionMode), a tap
 * opens its Permissions sheet (openPermissionSheet). Nothing while it loads
 * or for an agent with no modes.
 */
export function PermissionChip({
  session,
  variant,
  className,
}: PermissionChipProps) {
  const chip = usePermissionChip(session);
  if (!chip) return null;
  const header = variant === "header";
  return (
    <button
      type="button"
      aria-label={chip.ariaLabel}
      aria-haspopup="dialog"
      title={chip.title}
      // A box keeps its focus, so the keyboard doesn't drop first
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptic("light");
        openPermissionSheet(session.id);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 border whitespace-nowrap active:opacity-70",
        header
          ? "h-11 rounded-[22px] px-3.5 text-[13px]"
          : "mode-pill font-semibold",
        TONE[chip.tone],
        className
      )}
    >
      <Shield
        aria-hidden
        className={header ? "h-3.5 w-3.5" : "h-3 w-3"}
        strokeWidth={2}
      />
      <span data-chip-label>{chip.label}</span>
      {chip.pending && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
    </button>
  );
}

/** The ⋯ menu's way to the sheet where the header has no room for the chip */
export function PermissionMenuItem({
  session,
  separator,
}: {
  session: Session;
  /** A line under it, when it heads the menu */
  separator?: boolean;
}) {
  const chip = usePermissionChip(session);
  if (!chip) return null;
  return (
    <>
      <DropdownMenuItem onSelect={() => openPermissionSheet(session.id)}>
        <Shield
          className={cn(
            "h-4 w-4",
            chip.tone === "danger" && "text-red-600 dark:text-[#FF8A9A]"
          )}
        />
        <span className="flex-1">Permissions: {chip.label}</span>
        {chip.pending && (
          <span
            aria-hidden
            title={chip.title}
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
          />
        )}
      </DropdownMenuItem>
      {separator && <DropdownMenuSeparator />}
    </>
  );
}
