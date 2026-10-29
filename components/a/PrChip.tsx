"use client";

import type { SessionPr } from "@/lib/settle-types";

/**
 * A session's PR as a small chip (N-Settle .chip.pr): "#107 open ·
 * ✓ checks passed", "#106 merged into main"; with `onSettle`, a merged one
 * reads "PR #106 merged · Settle" and the Settle part is a button
 */
export interface PrChipProps {
  pr: SessionPr;
  baseBranch?: string | null;
  onSettle?: () => void;
  className?: string;
}

export function PrChip(_props: PrChipProps) {
  return null; // M8 U3
}
