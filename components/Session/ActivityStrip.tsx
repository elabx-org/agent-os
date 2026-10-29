"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ChevronRight, Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useElapsed, useSessionActivity } from "@/hooks/useSessionActivity";
import { mobileNavStore } from "@/stores/mobileNav";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ActivityRail } from "./ActivityRail";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One row under the session header saying what it's doing, for screens with
 * no room for the live activity rail. Tapping it opens the rail as a sheet.
 */
export function ActivityStrip({
  session,
  active = true,
  className,
}: {
  session: Session;
  active?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Hidden while typing, as the slim header (the iOS app reports its keyboard)
  const { nativeKeyboard } = useSnapshot(mobileNavStore);
  const { state, now, files, agents, workflows } = useSessionActivity(session, {
    active,
  });
  const elapsed = useElapsed(state === "work" ? now.startedAt : undefined);
  const needs = state === "needs";

  const counts = [
    files.count > 0 && plural(files.count, "file"),
    // Live ones only; the rail lists the finished too
    agents.running > 0 && plural(agents.running, "agent"),
    workflows.running > 0 && plural(workflows.running, "workflow"),
  ].filter(Boolean);

  return (
    <div
      className={cn(
        // The header's side insets, so the two line up
        "kb-compact-hide bg-background shrink-0 pt-1 pr-[calc(0.5rem+var(--safe-right,env(safe-area-inset-right)))] pl-[calc(0.5rem+env(safe-area-inset-left))]",
        nativeKeyboard && "hidden",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "bg-secondary/60 text-muted-foreground active:bg-accent hover:bg-accent/60 flex h-9 w-full min-w-0 touch-manipulation items-center gap-2 rounded-xl px-2.5 text-[12.5px] whitespace-nowrap ring-1 ring-inset",
          needs ? "ring-amber-400/40" : "ring-border"
        )}
      >
        <span className="grid w-3.5 shrink-0 place-items-center">
          {needs ? (
            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(242,176,30,.18)]" />
          ) : state === "work" ? (
            <Loader2 className="text-work h-3.5 w-3.5 animate-spin" />
          ) : (
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                state === "done"
                  ? "bg-emerald-500"
                  : state === "error"
                    ? "bg-red-500"
                    : "bg-muted-foreground/50"
              )}
            />
          )}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate text-left">
          {needs ? "Waiting for you" : now.label}
          {now.command && (
            <>
              {needs ? " · " : " "}
              <code
                title={now.command}
                className="text-muted-foreground font-mono text-[11.5px]"
              >
                {tail(now.command)}
              </code>
            </>
          )}
          {elapsed && (
            <span className="text-muted-foreground tabular-nums">
              {" "}
              · {elapsed}
            </span>
          )}
        </span>
        {counts.length > 0 && (
          <span className="shrink-0">{counts.join(" · ")}</span>
        )}
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </button>

      <LiveActivitySheet
        session={session}
        active={active}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

/** The live activity rail as a sheet, for screens with no room beside the pane */
export function LiveActivitySheet({
  session,
  active,
  open,
  onOpenChange,
}: {
  session: Session;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Live activity</SheetTitle>
          <SheetDescription className="sr-only">
            What this session is doing, its changes and agents
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="px-2">
          {/* Mounted only while open: the rail looks up the PR too */}
          {open && (
            <ActivityRail
              session={session}
              active={active}
              compact
              onNavigate={() => onOpenChange(false)}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** A path's end, where its file name is: the start is cut off first anyway */
function tail(command: string): string {
  if (/\s/.test(command) || !command.includes("/")) return command;
  const parts = command.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : command;
}
