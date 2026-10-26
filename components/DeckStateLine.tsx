"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElapsed, useSessionActivity } from "@/hooks/useSessionActivity";
import type { Session } from "@/lib/db";

/**
 * On the fold deck, in place of the activity strip: what the session is doing
 * right now, big enough to read from across the table. Mounted only there,
 * so it polls only then.
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

  return (
    <div className="border-border flex h-12 shrink-0 items-center gap-2.5 overflow-hidden border-b px-4 whitespace-nowrap">
      {needs ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(242,176,30,.18)]" />
      ) : state === "work" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
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
    </div>
  );
}
