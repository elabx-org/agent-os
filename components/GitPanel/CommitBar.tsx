"use client";

import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { commitLabel } from "./git-format";
import type { GitModel } from "./useGitModel";

type CommitProps = Pick<
  GitModel,
  | "message"
  | "setMessage"
  | "target"
  | "canCommit"
  | "committing"
  | "commit"
  | "generate"
  | "generating"
>;

/**
 * E-Git's commit: the message as a pill beside Commit. Enter commits; the
 * sparkle writes the message with Claude while the field is empty
 */
export function CommitBar(m: CommitProps) {
  return (
    <form
      className="flex min-w-0 gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        m.commit();
      }}
    >
      <div className="relative flex min-w-0 flex-1">
        <input
          aria-label="Commit message"
          placeholder="Commit message"
          value={m.message}
          onChange={(e) => m.setMessage(e.target.value)}
          enterKeyHint="send"
          className={cn(
            "pill-field placeholder:text-muted-foreground/70",
            !m.message && "pr-11"
          )}
        />
        {!m.message && (
          <button
            type="button"
            onClick={m.generate}
            disabled={m.generating}
            aria-label="Write with Claude"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-full"
          >
            {m.generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      <button
        type="submit"
        disabled={!m.canCommit}
        aria-label={commitLabel(m.target.count)}
        className="pill pill-primary flex-none active:opacity-80 disabled:opacity-50"
      >
        {m.committing && <Loader2 className="h-4 w-4 animate-spin" />}
        Commit
      </button>
    </form>
  );
}

/**
 * D-Git's commit: a card with the message, then Write with Claude and
 * Commit N files. ⌘/Ctrl+Enter commits
 */
export function CommitBox(m: CommitProps) {
  return (
    <>
      <label className="group-card block px-3.5 py-3">
        <span className="text-muted-foreground mb-1.5 block text-[13px]">
          Commit message
        </span>
        <textarea
          value={m.message}
          onChange={(e) => m.setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              m.commit();
            }
          }}
          className="block h-[60px] w-full resize-none bg-transparent text-[14px] outline-0"
        />
      </label>
      <div className="flex min-w-0 gap-2">
        <button
          type="button"
          onClick={m.generate}
          disabled={m.generating}
          className="pill pill-secondary pill-sm flex-none active:opacity-80 disabled:opacity-60"
        >
          {m.generating && <Loader2 className="h-4 w-4 animate-spin" />}
          Write with Claude
        </button>
        <button
          type="button"
          onClick={m.commit}
          disabled={!m.canCommit}
          className="pill pill-primary pill-sm min-w-0 flex-1 active:opacity-80 disabled:opacity-50"
        >
          {m.committing && <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="truncate">{commitLabel(m.target.count)}</span>
        </button>
      </div>
    </>
  );
}
