"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { UnifiedDiff } from "@/components/DiffViewer";
import { getDiffFileName } from "@/lib/diff-parser";
import type { SessionDiff } from "@/lib/turn-types";
import { Counts } from "./ToolCard";

/**
 * A turn's changes, full screen as the git view's diff (DiffModal): every
 * file of GET /api/sessions/[id]/diff?scope=turn:N
 */
export function TurnDiff({
  sessionId,
  turnNo,
  onClose,
}: {
  sessionId: string;
  turnNo: number;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<SessionDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    fetch(`/api/sessions/${sessionId}/diff?scope=turn:${turnNo}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as SessionDiff;
        if (!stale) setDiff(data);
      })
      .catch(() => !stale && setError("Couldn't load this turn's changes"));
    return () => {
      stale = true;
    };
  }, [sessionId, turnNo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const added = diff?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const removed = diff?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;

  return createPortal(
    <div
      role="dialog"
      aria-label={`Turn ${turnNo} changes`}
      className="bg-background fixed inset-0 z-50 flex flex-col"
    >
      <div className="border-border flex items-center gap-2 border-b px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="active:bg-accent hover:bg-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="t-head truncate">Turn {turnNo}</h3>
          {diff && (
            <p className="text-muted-foreground text-xs">
              {diff.files.length} {diff.files.length === 1 ? "file" : "files"}
            </p>
          )}
        </div>
        {diff && <Counts added={added} removed={removed} />}
        <span className="w-3" />
      </div>
      <div className="flex-1 overflow-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          {!diff && !error && (
            <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the changes…
            </div>
          )}
          {error && (
            <p className="text-muted-foreground py-8 text-sm">{error}</p>
          )}
          {diff && !diff.files.length && (
            <p className="text-muted-foreground py-8 text-sm">
              No changes to display
            </p>
          )}
          {diff?.files.map((file, i) => (
            <UnifiedDiff
              key={`${getDiffFileName(file)}-${i}`}
              diff={file}
              fileName={getDiffFileName(file)}
              expanded
              wrap
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
