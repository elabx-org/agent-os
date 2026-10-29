"use client";

import { STATE_DOT_CLASS, type AgentState } from "@/lib/agent-state";
import { cn } from "@/lib/utils";

/** A state's colour as a dot: 8px, or 6px inside a row's subtitle */
export function StateDot({
  state,
  size = 8,
  className,
}: {
  state: AgentState;
  size?: 6 | 8;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block flex-none rounded-full",
        size === 8 ? "h-2 w-2" : "h-1.5 w-1.5",
        STATE_DOT_CLASS[state],
        className
      )}
    />
  );
}
