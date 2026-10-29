"use client";

import type { PlanState } from "@/lib/claude-plan";

export interface PlanChipProps {
  plan: PlanState;
  /** Opens the Live activity (its Plan) */
  onOpen?: () => void;
  className?: string;
}

// M2 contract: props only; U2.3 builds it

/**
 * Closed-Chat's Plan card: "Plan 3 of 5 · Merge and deploy" with a chevron,
 * and one segment per step (done violet, current amber, rest grey)
 */
export function PlanChip(_props: PlanChipProps) {
  return null;
}
