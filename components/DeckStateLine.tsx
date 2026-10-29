"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElapsed, useSessionActivity } from "@/hooks/useSessionActivity";
import type { Session } from "@/lib/db";
import { LiveActivitySheet } from "@/components/Session/ActivityStrip";

/**
 * On the fold deck, in place of the activity strip: what the session is doing
 * right now, big enough to read from across the table. Tapping it opens the
 * live activity, as the strip does. Mounted only there, so it polls only then.
 */
export function DeckStateLine({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const { state, now } = useSessionActivity(session, { active });
  const elapsed = useElapsed(state === "work" ? now.startedAt : undefined);
  const needs = state === "needs";
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="border-border active:bg-accent flex h-12 w-full shrink-0 touch-manipulation items-center gap-2.5 overflow-hidden border-b px-4 text-left whitespace-nowrap"
      >
        {needs ? (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(242,176,30,.18)]" />
        ) : state === "work" ? (
          <Loader2 className="text-work h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              state === "done"
                ? "bg-emerald-500"
                : state === "error"
                  ? "bg-red-500"
                  : "bg-muted-foreground/50"
            )}
          />
        )}
        <span className="shrink-0 text-xl font-medium">{now.label}</span>
        {now.command && (
          <code
            title={now.command}
            className="text-muted-foreground min-w-0 truncate font-mono text-base"
          >
            {now.command}
          </code>
        )}
        {elapsed && (
          <span className="text-muted-foreground ml-auto shrink-0 text-sm tabular-nums">
            {elapsed}
          </span>
        )}
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "text-muted-foreground h-4 w-4 shrink-0",
            !elapsed && "ml-auto"
          )}
        />
      </button>
      <LiveActivitySheet
        session={session}
        active={active}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
