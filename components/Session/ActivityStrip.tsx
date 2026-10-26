"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useElapsed, useSessionActivity } from "@/hooks/useSessionActivity";
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
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
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
              <code className="text-muted-foreground font-mono text-[11.5px]">
                {now.command}
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

      <Sheet open={open} onOpenChange={setOpen}>
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
                onNavigate={() => setOpen(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
