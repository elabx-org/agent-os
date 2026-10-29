"use client";

import { Loader2, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { rangeLabel } from "@/lib/review-format";
import { commentCount } from "@/lib/review-send";
import type { ReviewComment } from "@/lib/review-types";

export interface CommentTrayProps {
  /** The pending comments, oldest first */
  comments: ReviewComment[];
  agentName: string;
  sending?: boolean;
  error?: string | null;
  onSend: () => void;
  onDiscard: () => void;
  /** Jump to a comment's line in the diff */
  onOpen?: (comment: ReviewComment) => void;
  onRemove?: (comment: ReviewComment) => void;
  className?: string;
}

/**
 * The desktop's tray under the diff (D-Diff): "2 comments · Discard · Send
 * to Claude", each comment's file:line and text. Hidden with no comments.
 */
export function CommentTray({
  comments,
  agentName,
  sending = false,
  error,
  onSend,
  onDiscard,
  onOpen,
  onRemove,
  className,
}: CommentTrayProps) {
  if (!comments.length) return null;
  const count = commentCount(comments.length);

  return (
    <section
      aria-label={`Review comments, ${count}`}
      className={cn(
        "bg-card border-meter/40 flex min-w-0 flex-col gap-2.5 rounded-[20px] border py-3 pr-3 pl-4 shadow-[0_-12px_40px_rgba(0,0,0,0.6)]",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <MessageSquare
          className="text-meter h-5 w-5 shrink-0"
          aria-hidden="true"
        />
        <span className="t-head min-w-0 flex-1 truncate">{count}</span>
        <button
          type="button"
          onClick={onDiscard}
          disabled={sending}
          className="pill pill-secondary pill-sm shrink-0 active:opacity-80 disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          className="pill pill-primary pill-sm min-w-0 shrink active:opacity-80 disabled:opacity-60"
        >
          {sending && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          <span className="truncate">Send to {agentName}</span>
        </button>
      </div>
      <ul className="flex min-w-0 flex-col gap-0.5">
        {comments.map((c) => {
          const label = rangeLabel(c);
          const text = (
            <>
              <span className="text-muted-foreground w-[clamp(6rem,35%,13.75rem)] shrink-0 truncate font-mono text-[13px]">
                {label}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.body}</span>
            </>
          );
          return (
            <li key={c.id} className="flex min-w-0 items-center gap-1">
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(c)}
                  title={`${label}: ${c.body}`}
                  className="hover:bg-accent active:bg-accent flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 text-left text-sm"
                >
                  {text}
                </button>
              ) : (
                <div
                  title={`${label}: ${c.body}`}
                  className="flex min-h-8 min-w-0 flex-1 items-center gap-2.5 py-1 text-sm"
                >
                  {text}
                </div>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(c)}
                  disabled={sending}
                  aria-label={`Remove the comment on ${label}`}
                  className="text-muted-foreground hover:bg-accent active:bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-[var(--del)]">
          {error}
        </p>
      )}
    </section>
  );
}
