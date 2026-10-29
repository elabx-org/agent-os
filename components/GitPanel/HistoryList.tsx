"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useCommitHistory } from "@/data/git/queries";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/lib/git-types";
import { isOwnCommit, shortAge } from "./git-format";

interface HistoryListProps {
  repoPath: string;
  branch: string;
  info: BranchInfo;
  /** D-Git: "History" as a heading beside the toggle */
  wide?: boolean;
  onOpen: (hash: string) => void;
}

/**
 * The commits (D-Git's History, E-Git's tab): This branch or its base, a
 * ring per commit, filled for the branch's own; a tap opens the commit
 */
export function HistoryList({
  repoPath,
  branch,
  info,
  wide,
  onOpen,
}: HistoryListProps) {
  const [onBranch, setOnBranch] = useState(true);
  const base = info.baseBranch;
  const canToggle = !!base && branch !== base;
  const showBranch = onBranch || !canToggle;
  const {
    data: commits,
    isPending,
    isError,
  } = useCommitHistory(repoPath, 30, showBranch ? undefined : base!);

  const toggle = canToggle && (
    <div className="seg bg-card flex-none" role="group" aria-label="Branch">
      <button
        type="button"
        aria-pressed={showBranch}
        onClick={() => setOnBranch(true)}
      >
        This branch
      </button>
      <button
        type="button"
        aria-pressed={!showBranch}
        onClick={() => setOnBranch(false)}
        className="max-w-[160px] truncate"
      >
        {base}
      </button>
    </div>
  );

  return (
    <>
      {wide ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-head">History</h2>
          {toggle}
        </div>
      ) : (
        toggle && <div className="flex">{toggle}</div>
      )}
      {isPending ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : isError ? (
        <p className="text-muted-foreground px-1 text-[14px]">
          Couldn&apos;t load the history
        </p>
      ) : !commits?.length ? (
        <p className="text-muted-foreground px-1 text-[14px]">No commits yet</p>
      ) : (
        <div className="group-card" role="list" aria-label="Commits">
          {commits.map((c, i) => (
            <button
              key={c.hash}
              type="button"
              role="listitem"
              onClick={() => onOpen(c.hash)}
              className="commit-row hover:bg-foreground/[0.03] w-full min-w-0 text-left active:opacity-80"
            >
              <span
                className={cn(
                  "commit-node",
                  isOwnCommit(i, info.aheadOfBase, showBranch) && "own"
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px]">{c.subject}</span>
                <span className="text-muted-foreground truncate text-[13px]">
                  {c.author} · {shortAge(c.timestamp * 1000)}
                </span>
              </span>
              <span className="text-muted-foreground flex-none font-mono text-[13px]">
                {c.shortHash}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
