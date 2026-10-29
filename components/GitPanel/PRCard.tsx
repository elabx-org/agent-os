"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PRSummary } from "@/lib/git-types";
import {
  checksLabel,
  checksTone,
  prBlurb,
  prMetaCaption,
  prStateCaption,
} from "./git-format";

interface PRCardProps {
  pr: PRSummary;
  /** D-Git's card: title as a heading, the body's first lines, who opened it */
  wide?: boolean;
  merging?: boolean;
  onMerge: () => void;
  /** E-Git's Review, D-Git's Review in chat */
  onReview: () => void;
  /** #N: the PR's own review page */
  onOpen: () => void;
}

function Checks({ pr, chip }: { pr: PRSummary; chip?: boolean }) {
  if (!pr.checks) return null;
  return (
    <span
      className={cn(
        "flex flex-none items-center gap-[5px]",
        chip && "chip gap-1.5"
      )}
    >
      <span className={cn("check-dot", pr.checks)} />
      {checksLabel(pr.checks)}
    </span>
  );
}

/**
 * The branch's PR, edged by its checks (E-Git, D-Git): #N and title, the
 * checks, Merge while it's open, and Review
 */
export function PRCard({
  pr,
  wide,
  merging,
  onMerge,
  onReview,
  onOpen,
}: PRCardProps) {
  const open = pr.state === "open";
  const number = (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open pull request #${pr.number}`}
      className={cn(
        "text-primary dark:text-meter flex-none font-mono",
        wide ? "text-[15px]" : "text-[13px]"
      )}
    >
      #{pr.number}
    </button>
  );
  const mergeButton = open && (
    <button
      type="button"
      onClick={onMerge}
      disabled={merging || pr.isDraft}
      className={cn(
        "pill pill-primary active:opacity-80 disabled:opacity-50",
        !wide && "min-w-0 flex-1"
      )}
    >
      {merging && <Loader2 className="h-4 w-4 animate-spin" />}
      Merge
    </button>
  );

  if (wide) {
    const blurb = prBlurb(pr.body || "");
    return (
      <section
        aria-label={`Pull request #${pr.number}`}
        className={cn(
          "pr-card @container/pr gap-3 p-[18px]",
          checksTone(pr.checks)
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {number}
          <span className="t-head line-clamp-2 min-w-0 flex-1">{pr.title}</span>
          <Checks pr={pr} chip />
        </div>
        {blurb && (
          <p className="text-muted-foreground line-clamp-2 text-[14px]">
            {blurb}
          </p>
        )}
        {/* A narrow card puts the caption on a line of its own */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5">
          <span className="text-muted-foreground w-full min-w-0 truncate text-[13px] @min-[640px]/pr:w-auto @min-[640px]/pr:flex-1">
            {prMetaCaption(pr)}
          </span>
          <button
            type="button"
            onClick={onReview}
            className="pill pill-secondary active:opacity-80"
          >
            Review in chat
          </button>
          {mergeButton}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={`Pull request #${pr.number}`}
      className={cn("pr-card", checksTone(pr.checks))}
    >
      <div className="flex min-w-0 items-center gap-2">
        {number}
        <span className="min-w-0 flex-1 truncate text-[16px] font-medium">
          {pr.title}
        </span>
      </div>
      <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-[13px]">
        <Checks pr={pr} />
        <span className="min-w-0 truncate">{prStateCaption(pr)}</span>
      </div>
      <div className="flex gap-2.5">
        {mergeButton}
        <button
          type="button"
          onClick={onReview}
          className="pill pill-secondary min-w-0 flex-1 active:opacity-80"
        >
          Review
        </button>
      </div>
    </section>
  );
}

/** D-Git without a PR: a quiet card, New pull request off the base branch */
export function NoPRCard({ onCreate }: { onCreate?: () => void }) {
  return (
    <section className="group-card flex min-h-[72px] items-center gap-3 px-[18px] py-3.5">
      <span className="text-muted-foreground min-w-0 flex-1 text-[15px]">
        No pull request
      </span>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="pill pill-secondary pill-sm active:opacity-80"
        >
          New pull request
        </button>
      )}
    </section>
  );
}
