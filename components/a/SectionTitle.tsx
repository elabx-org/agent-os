"use client";

import type { ReactNode } from "react";
import type { AgentState } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { StateDot } from "./StateDot";

/** The 15/600 grey title above a group card (.t-sec), with an optional dot */
export function SectionTitle({
  children,
  state,
  action,
  className,
}: {
  children: ReactNode;
  /** A state dot before the title (Open-Now: Needs you, Working) */
  state?: AgentState;
  /** A link on the right, like "All projects" */
  action?: { label: ReactNode; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn("t-sec", className)}>
      {state && <StateDot state={state} />}
      <span className="min-w-0 truncate">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="relative ml-auto shrink-0 text-sm font-medium text-violet-700 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] active:opacity-70 dark:text-violet-300"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
