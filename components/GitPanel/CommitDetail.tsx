"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { FileDiffCard } from "@/components/DiffViewer";
import { useCommitDetail, useCommitFileDiff } from "@/data/git/queries";
import { parseDiff } from "@/lib/diff-parser";
import { gitBadgeClass, gitBadgeOf } from "@/lib/git-types";
import { commitFileOpen, setCommitFileOpen } from "@/stores/gitPlace";
import type { CommitFile } from "@/lib/git-history";
import { shortAge } from "./git-format";
import { Subpage } from "./Subpage";

interface CommitDetailProps {
  repoPath: string;
  hash: string;
  layer?: boolean;
  closed?: boolean;
  wrap?: boolean;
  onBack: () => void;
}

/** A commit from History: its message, then each file's diff on its own card */
export function CommitDetail({
  repoPath,
  hash,
  layer,
  closed,
  wrap,
  onBack,
}: CommitDetailProps) {
  const { data: commit, isPending, isError } = useCommitDetail(repoPath, hash);

  return (
    <Subpage
      backLabel="Back to history"
      onBack={onBack}
      layer={layer}
      closed={closed}
      title={commit?.subject ?? hash.slice(0, 7)}
      subtitle={
        commit
          ? `${commit.shortHash} · ${commit.author} · ${shortAge(commit.timestamp * 1000)}`
          : undefined
      }
    >
      {isPending ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : isError || !commit ? (
        <p className="text-muted-foreground py-4 text-[14px]">
          Couldn&apos;t load this commit
        </p>
      ) : (
        <div className="flex flex-col gap-3 pt-1">
          {commit.body.trim() && (
            <p className="text-muted-foreground text-[14px] whitespace-pre-wrap">
              {commit.body.trim()}
            </p>
          )}
          <h3 className="t-sec">
            {commit.files.length === 1
              ? "1 file"
              : `${commit.files.length} files`}
          </h3>
          {commit.files.map((f) => (
            <CommitFileCard
              key={f.path}
              repoPath={repoPath}
              hash={hash}
              file={f}
              wrap={wrap}
            />
          ))}
        </div>
      )}
    </Subpage>
  );
}

/** One file: a row until opened, then its diff card (fetched on opening) */
function CommitFileCard({
  repoPath,
  hash,
  file,
  wrap,
}: {
  repoPath: string;
  hash: string;
  file: CommitFile;
  wrap?: boolean;
}) {
  // Kept across a fold, a turn or a reload (stores/gitPlace)
  const [open, setOpenState] = useState(() => commitFileOpen(hash, file.path));
  const setOpen = (next: boolean) => {
    setOpenState(next);
    setCommitFileOpen(hash, file.path, next);
  };
  const { data: diff, isPending } = useCommitFileDiff(
    repoPath,
    open ? hash : null,
    open ? file.path : null
  );
  const badge = gitBadgeOf(file.status);

  if (open && diff !== undefined)
    return (
      <FileDiffCard
        diff={parseDiff(diff)}
        path={file.path}
        badge={badge}
        expanded
        onToggle={(next) => setOpen(next)}
        wrap={wrap}
      />
    );

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={false}
      className="group-card row min-h-[48px] w-full min-w-0 py-0 text-left active:opacity-80"
    >
      <span className={`git-letter ${gitBadgeClass(badge)}`}>{badge}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      </span>
      {!!file.additions && (
        <span className="n-add flex-none text-[12px]">+{file.additions}</span>
      )}
      {!!file.deletions && (
        <span className="n-del flex-none text-[12px]">−{file.deletions}</span>
      )}
      {open && isPending ? (
        <Loader2 className="text-muted-foreground h-4 w-4 flex-none animate-spin" />
      ) : (
        <ChevronRight className="text-muted-foreground/70 h-4 w-4 flex-none" />
      )}
    </button>
  );
}
