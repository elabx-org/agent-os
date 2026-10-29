"use client";

import type { ReactNode } from "react";
import type { AgentState } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { StateDot } from "./StateDot";

/** The 15/600 grey title above a group card (.t-sec), with an optional dot */
export function SectionTitle({
  children,
  state,
  className,
}: {
  children: ReactNode;
  /** A state dot before the title (Open-Now: Needs you, Working) */
  state?: AgentState;
  className?: string;
}) {
  return (
    <div className={cn("t-sec", className)}>
      {state && <StateDot state={state} />}
      {children}
    </div>
  );
}
