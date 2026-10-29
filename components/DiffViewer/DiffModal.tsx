"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSnapshot } from "valtio";
import { ChevronLeft, Minus, Plus, X } from "lucide-react";
import { UnifiedDiff, DiffCounts, DiffLines } from "./UnifiedDiff";
import { parseDiff, getDiffFileName } from "@/lib/diff-parser";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { mobileNavStore } from "@/stores/mobileNav";
import { cn } from "@/lib/utils";
import { splitPath } from "./diff-format";

interface DiffModalProps {
  diff: string;
  fileName?: string;
  onClose: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  isStaged?: boolean;
}

/**
 * One file's diff over everything: a full-height sheet on phones and the
 * Duo (back, name and folder, +N −N, Stage), a centred dialog on desktop
 */
export function DiffModal({
  diff,
  fileName,
  onClose,
  onStage,
  onUnstage,
  isStaged = false,
}: DiffModalProps) {
  const parsedDiff = parseDiff(diff);
  const displayName = fileName || getDiffFileName(parsedDiff);
  const { name, folder } = splitPath(displayName);
  const dialog = useLayoutMode() === "desktop";
  const { railWidth } = useSnapshot(mobileNavStore);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stage = (onStage || onUnstage) && (
    <button
      type="button"
      onClick={isStaged ? onUnstage : onStage}
      className={cn(
        "pill pill-sm shrink-0",
        isStaged ? "pill-secondary" : "pill-primary"
      )}
    >
      {isStaged ? (
        <Minus className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Plus className="h-4 w-4" aria-hidden="true" />
      )}
      {isStaged ? "Unstage" : "Stage"}
    </button>
  );

  const header = (
    <div className="flex items-center gap-3">
      {!dialog && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="pill pill-secondary h-11 w-11 shrink-0 p-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="t-head truncate font-mono">{name}</h3>
        {folder && (
          <p className="text-muted-foreground truncate text-[13px]">{folder}</p>
        )}
      </div>
      {diff && !parsedDiff.isBinary && (
        <DiffCounts
          added={parsedDiff.additions}
          removed={parsedDiff.deletions}
        />
      )}
      {stage}
      {dialog && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:bg-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const body = diff ? (
    <div className="tools">
      <DiffLines diff={parsedDiff} wrap={!dialog} />
    </div>
  ) : (
    <p className="text-muted-foreground py-8 text-center text-sm">
      No changes to display
    </p>
  );

  const content = dialog ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/55"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={displayName}
        className="relative flex max-h-[85vh] w-full max-w-4xl flex-col gap-3 overflow-hidden rounded-[20px] bg-[var(--sheet)] p-4"
      >
        {header}
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      </section>
    </div>
  ) : (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={displayName}
      className="bg-background fixed inset-0 z-50 flex flex-col"
      style={{ right: railWidth }}
    >
      <div className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        {header}
      </div>
      <div className="flex-1 overflow-auto overscroll-contain px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {body}
      </div>
    </section>
  );

  return typeof document === "undefined"
    ? content
    : createPortal(content, document.body);
}

interface DiffViewProps {
  diff: string;
  fileName?: string;
  wrap?: boolean;
}

/**
 * Inline diff view (non-modal)
 * For embedding in other components
 */
export function DiffView({ diff, fileName, wrap }: DiffViewProps) {
  const parsedDiff = parseDiff(diff);
  const displayName = fileName || getDiffFileName(parsedDiff);

  if (!diff) {
    return (
      <div className="text-muted-foreground p-4 text-center">
        <p className="text-sm">No changes to display</p>
      </div>
    );
  }

  return (
    <UnifiedDiff
      diff={parsedDiff}
      fileName={displayName}
      expanded={true}
      wrap={wrap}
    />
  );
}
