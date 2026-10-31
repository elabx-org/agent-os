"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnswerPrompt } from "@/data/prompts/queries";
import { replyContextKeys } from "@/hooks/useReplyContext";
import type { ReplyContext } from "@/lib/reply-context";

const CHIP =
  "bg-secondary text-foreground flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] pointer-coarse:h-11 active:bg-accent hover:bg-accent disabled:opacity-50 disabled:hover:bg-secondary";

interface AnswerChipsProps {
  context: ReplyContext;
  sessionId: string;
  /** After an option was picked without an error */
  onAnswered?: () => void;
  /** "Other…": answer in your own words, in the draft */
  onOther?: () => void;
  className?: string;
}

/**
 * The question's options as numbered chips that answer it straight away,
 * through the same prompt answer the Inbox uses. An option the screen doesn't
 * show yet can't be picked.
 */
export function AnswerChips({
  context,
  sessionId,
  onAnswered,
  onOther,
  className,
}: AnswerChipsProps) {
  const { answer, answering, error } = useAnswerPrompt(sessionId);
  const queryClient = useQueryClient();

  // Done once the answer has gone without an error
  const wasAnswering = useRef(false);
  useEffect(() => {
    if (answering !== null) {
      wasAnswering.current = true;
      return;
    }
    if (!wasAnswering.current) return;
    wasAnswering.current = false;
    queryClient.invalidateQueries({
      queryKey: replyContextKeys.session(sessionId),
    });
    if (!error) onAnswered?.();
  }, [answering, error, onAnswered, queryClient, sessionId]);

  // A question with all its parts known is answered in AskCard
  if (!context.options.length || context.questions?.length) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="flex flex-wrap gap-1.5"
        // Keeps the box focused, so the keyboard stays up
        onMouseDown={(e) => e.preventDefault()}
      >
        {context.options.map((option) => {
          const live = option.answer;
          return (
            <button
              key={option.index}
              type="button"
              disabled={!live || answering !== null}
              onClick={() => live && answer(live)}
              title={
                live
                  ? option.description || option.label
                  : "Not on Claude's screen yet"
              }
              className={CHIP}
            >
              {answering !== null && answering === live?.index ? (
                <Loader2 className="text-muted-foreground h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                  {option.index}
                </span>
              )}
              <span className="min-w-0 truncate">{option.label}</span>
            </button>
          );
        })}
        {context.kind === "ask" && onOther && (
          <button type="button" onClick={onOther} className={CHIP}>
            Other…
          </button>
        )}
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
