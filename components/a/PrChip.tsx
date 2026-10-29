"use client";

import {
  Check,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  X,
} from "lucide-react";
import type { PRChecks } from "@/lib/git-types";
import { prChipLabel, type SessionPr } from "@/lib/settle-types";
import { cn } from "@/lib/utils";

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

// The mocks' .t-green / .t-amber / .t-red, darker on white
const CHECKS: Record<
  Exclude<PRChecks, null>,
  { label: string; tone: string; icon?: typeof Check }
> = {
  passed: {
    label: "checks passed",
    tone: "text-emerald-700 dark:text-work",
    icon: Check,
  },
  pending: {
    label: "checks running",
    tone: "text-amber-700 dark:text-needs",
  },
  failed: {
    label: "checks failed",
    tone: "text-red-700 dark:text-[#F87171]",
    icon: X,
  },
};

const VIOLET = "text-[#6D28D9] dark:text-[#C4B5FD]";

/** The 24px pill (.chip.pr): 12px words, 13px icon */
const CHIP =
  "inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-[5px] self-start rounded-[12px] bg-foreground/[0.08] px-[9px] text-[12px] whitespace-nowrap text-foreground/78 dark:bg-[#1C1C20] dark:text-[#C7C7CC]";

export function PrChip({ pr, baseBranch, onSettle, className }: PrChipProps) {
  const merged = pr.state === "merged";

  if (merged && onSettle)
    return (
      <span className={cn(CHIP, "pr-1", className)}>
        <GitMerge
          aria-hidden
          className={cn("h-[13px] w-[13px] shrink-0", VIOLET)}
        />
        <span className="truncate">PR #{pr.number} merged</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSettle();
          }}
          aria-label={`Settle, PR #${pr.number} merged`}
          className={cn(
            "pointer-events-auto relative h-5 rounded-[10px] px-1.5 font-semibold after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] active:opacity-70",
            VIOLET
          )}
        >
          Settle
        </button>
      </span>
    );

  const Icon = merged
    ? GitMerge
    : pr.state === "closed"
      ? GitPullRequestClosed
      : GitPullRequest;
  const checks = !merged && pr.checks ? CHECKS[pr.checks] : null;

  return (
    <span className={cn(CHIP, className)}>
      <Icon
        aria-hidden
        className={cn("h-[13px] w-[13px] shrink-0", merged && VIOLET)}
      />
      <span className="truncate">{prChipLabel(pr, baseBranch)}</span>
      {checks && (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className={cn("flex items-center gap-[5px]", checks.tone)}>
            {checks.icon ? (
              <checks.icon
                aria-hidden
                strokeWidth={2.8}
                className="h-3 w-3 shrink-0"
              />
            ) : (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-current"
              />
            )}
            {checks.label}
          </span>
        </>
      )}
    </span>
  );
}
