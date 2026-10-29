"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionActivity } from "@/hooks/useSessionActivity";
import type { Session } from "@/lib/db";
import { agentName } from "@/components/a/Avatar";
import { StateDot } from "@/components/a/StateDot";
import { openLiveSheet } from "@/components/Session/ActivityStrip";
import { formatAge, workingLine } from "@/components/Session/activity-format";
import { STATE_WORD } from "@/lib/agent-state";

/**
 * On the fold deck, in place of the activity strip (Fold-Chat): what the
 * session is doing right now, big enough to read from across the table,
 * with its plan and clock on the right ("Plan 3 of 5 · 9m"). Tapping it
 * opens the live activity, as the strip does. Mounted only there, so it
 * polls only then.
 */
export function DeckStateLine({
  session,
  active,
  className,
}: {
  session: Session;
  active: boolean;
  className?: string;
}) {
  const { state, now, plan } = useSessionActivity(session, {
    active,
    plan: true,
  });
  const needs = state === "needs";
  const work = state === "work";
  const clock =
    (needs || work) && now.startedAt !== undefined
      ? formatAge(Date.now() - now.startedAt)
      : null;
  const right = [
    plan && plan.total > 0 ? `Plan ${plan.done} of ${plan.total}` : null,
    clock,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("shrink-0 px-6 pt-2 pb-1", className)}>
      <button
        type="button"
        onClick={openLiveSheet}
        aria-haspopup="dialog"
        className={cn(
          "status-card active:bg-accent h-[52px] w-full touch-manipulation gap-3 rounded-[26px] px-4 text-left text-[17px] whitespace-nowrap",
          needs && "tone-needs",
          work && "tone-work"
        )}
      >
        <StateDot state={state} />
        <span className="min-w-0 flex-1 truncate">
          {needs
            ? now.label === "Your turn"
              ? "Your turn"
              : `${agentName(session.agent_type)} is asking`
            : work
              ? workingLine(now)
              : STATE_WORD[state]}
        </span>
        {right && (
          <span className="text-muted-foreground shrink-0 text-[15px] tabular-nums">
            {right}
          </span>
        )}
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground h-4 w-4 shrink-0"
        />
      </button>
    </div>
  );
}
