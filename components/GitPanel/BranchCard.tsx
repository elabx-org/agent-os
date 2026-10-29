"use client";

import { ChevronDown, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BranchSelector } from "./BranchSelector";

interface BranchCardProps {
  workingDirectory: string;
  branch: string;
  /** "2 ahead of main · pushed" (git-format's branchCaption) */
  caption: string;
  hasChanges: boolean;
  /** A project's several repos: shown, not switched */
  fixed?: boolean;
  onBranchChanged: () => void;
}

/**
 * The branch on one card (E-Git, D-Git): violet branch mark, the name in
 * mono, where it stands under it; a tap lists the branches to switch to
 */
export function BranchCard({
  workingDirectory,
  branch,
  caption,
  hasChanges,
  fixed,
  onBranchChanged,
}: BranchCardProps) {
  const card = (switching: boolean) => (
    <button
      type="button"
      disabled={fixed || switching}
      aria-label={`Branch ${branch}${caption ? `, ${caption}` : ""}`}
      className={cn(
        "group-card row w-full min-w-0 text-left",
        !fixed && "active:opacity-80"
      )}
    >
      {switching ? (
        <Loader2 className="text-primary dark:text-meter h-5 w-5 flex-none animate-spin" />
      ) : (
        <GitBranch
          className="text-primary dark:text-meter h-5 w-5 flex-none"
          strokeWidth={1.9}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[14px]">
          {branch || "No branch"}
        </span>
        {caption && (
          <span className="text-muted-foreground truncate text-[13px]">
            {caption}
          </span>
        )}
      </span>
      {!fixed && (
        <ChevronDown
          className="text-muted-foreground/70 h-4 w-4 flex-none"
          strokeWidth={2}
        />
      )}
    </button>
  );

  if (fixed) return card(false);
  return (
    <BranchSelector
      workingDirectory={workingDirectory}
      currentBranch={branch}
      hasChanges={hasChanges}
      onBranchChanged={onBranchChanged}
    >
      {card}
    </BranchSelector>
  );
}
