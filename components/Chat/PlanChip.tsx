"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { navStore } from "@/lib/nav-actions";
import { currentStep, type PlanState } from "@/lib/claude-plan";

export interface PlanChipProps {
  plan: PlanState;
  /** Opens the Live activity (its Plan) */
  onOpen?: () => void;
  className?: string;
}

/**
 * Closed-Chat's Plan card: "Plan 3 of 5 · Merge and deploy" with a chevron,
 * and one segment per step (done violet, current amber, rest grey)
 */
export function PlanChip({ plan, onOpen, className }: PlanChipProps) {
  const step = currentStep(plan);
  return (
    <button
      type="button"
      onClick={onOpen ?? (() => navStore.openLive())}
      aria-label={`Plan, ${plan.done} of ${plan.total} done${step ? `: ${step.text}` : ""}. Show live activity`}
      className={cn(
        "plan-card w-full gap-1.5 px-3 py-2.5 text-left active:opacity-80",
        className
      )}
    >
      <span className="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-[13px]">
        <span className="text-foreground/90 shrink-0 font-semibold">Plan</span>
        <span className="min-w-0 flex-1 truncate">
          {plan.done} of {plan.total}
          {step && ` · ${step.text}`}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
      </span>
      <span aria-hidden="true" className="plan-segs w-full">
        {plan.items.map((s, i) => (
          <span
            key={i}
            className={
              s.status === "done"
                ? "done"
                : s.status === "active"
                  ? "active"
                  : ""
            }
          />
        ))}
      </span>
    </button>
  );
}
