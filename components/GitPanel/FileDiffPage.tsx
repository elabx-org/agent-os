"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { DiffView, FileDiffCard } from "@/components/DiffViewer";
import { parseDiff } from "@/lib/diff-parser";
import { gitBadgeOf } from "@/lib/git-types";
import type { AnyGitFile } from "./useGitModel";
import { Subpage } from "./Subpage";

interface FileDiffPageProps {
  file: AnyGitFile;
  diff: string;
  /** Every changed file in list order, for moving between diffs */
  files: AnyGitFile[];
  loading: boolean;
  /** Over the panel with prev/next and swipes (narrow); D-Git's main column otherwise */
  layer?: boolean;
  closed?: boolean;
  onBack: () => void;
  onOpen: (file: AnyGitFile) => void;
  onStage: (file: AnyGitFile) => void | Promise<void>;
  onUnstage: (file: AnyGitFile) => void | Promise<void>;
}

const same = (a: AnyGitFile, b: AnyGitFile) =>
  a.path === b.path &&
  a.staged === b.staged &&
  ("repoPath" in a ? a.repoPath : "") === ("repoPath" in b ? b.repoPath : "");

/**
 * One changed file's diff. Swipe or use the arrows to move through the
 * changes; staging a file moves on to the next one still to review
 */
export function FileDiffPage({
  file,
  diff,
  files,
  loading,
  layer,
  closed,
  onBack,
  onOpen,
  onStage,
  onUnstage,
}: FileDiffPageProps) {
  const index = files.findIndex((f) => same(f, file));
  const prev = index > 0 ? files[index - 1] : undefined;
  const next = index >= 0 ? files[index + 1] : undefined;
  const touch = useRef<{ x: number; y: number } | null>(null);

  const stage = async () => {
    const after = files
      .slice(index + 1)
      .find((f) => !f.staged && !same(f, file));
    await onStage(file);
    if (after) onOpen(after);
    else onBack();
  };

  const stageButton = (
    <button
      type="button"
      onClick={() => (file.staged ? onUnstage(file) : stage())}
      className={
        file.staged
          ? "pill pill-secondary pill-sm flex-none active:opacity-80"
          : "pill pill-primary pill-sm flex-none active:opacity-80"
      }
    >
      {file.staged ? "Unstage" : "Stage"}
    </button>
  );

  const name = file.path.split("/").pop() || file.path;
  const arrows = (
    <>
      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onOpen(prev)}
        aria-label="Previous file"
        className="flex size-9 flex-none items-center justify-center rounded-full disabled:opacity-30"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onOpen(next)}
        aria-label="Next file"
        className="flex size-9 flex-none items-center justify-center rounded-full disabled:opacity-30"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </>
  );

  return (
    <Subpage
      backLabel="Back to changes"
      onBack={onBack}
      layer={layer}
      closed={closed}
      title={<span className="font-mono text-[14px]">{name}</span>}
      subtitle={
        index >= 0
          ? `${index + 1} of ${files.length}${file.staged ? " · staged" : ""}`
          : undefined
      }
      actions={
        <>
          {arrows}
          {stageButton}
        </>
      }
    >
      <div
        className="pt-1"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
          const target = dx < 0 ? next : prev;
          if (target) onOpen(target);
        }}
      >
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : layer ? (
          <DiffView diff={diff} fileName={file.path} wrap />
        ) : diff ? (
          <FileDiffCard
            diff={parseDiff(diff)}
            path={file.path}
            badge={gitBadgeOf(file.status)}
            defaultExpanded
          />
        ) : (
          <p className="text-muted-foreground py-4 text-[14px]">
            No changes to show
          </p>
        )}
      </div>
    </Subpage>
  );
}
