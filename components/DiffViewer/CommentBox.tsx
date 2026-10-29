"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { linesCaption } from "@/lib/review-format";
import type { CommentFlow } from "./review-selection";
import type { LineRange } from "@/lib/review-types";
import { MAX_COMMENT_BODY } from "@/lib/review-types";

export interface CommentBoxProps {
  range: LineRange;
  flow: CommentFlow;
  /** "Claude": "Send to chat" (immediate) or "Comment" (tray) */
  agentName: string;
  busy?: boolean;
  error?: string | null;
  /** Resolves when it went (or was queued / added to the tray) */
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The comment box under the selected lines (O-Diff): "Lines 24 to 25", the
 * text, Cancel and Send to chat (Duo) or Comment (desktop: to the tray).
 * Keeps the text if the send fails. Cmd/Ctrl+Enter sends, Escape cancels.
 */
export function CommentBox({
  range,
  flow,
  agentName,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: CommentBoxProps) {
  const [body, setBody] = useState("");
  const [ownError, setOwnError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // Grows with the text, up to a few lines
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [body]);

  useEffect(() => {
    // Into view and focused, without scrolling the page under the keyboard twice
    area.current?.focus({ preventScroll: true });
    area.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const text = body.trim();
  const submit = async () => {
    if (!text || busy) return;
    setOwnError(null);
    try {
      await onSubmit(text);
    } catch (e) {
      setOwnError(e instanceof Error ? e.message : "Couldn't send it");
    }
  };

  const shown = error ?? ownError;
  return (
    <div className="px-3 pt-1.5 pb-2 font-sans">
      <div className="flex flex-col gap-2 rounded-[14px] border border-[hsl(var(--meter)/0.5)] bg-[var(--sheet)] px-3 py-2.5">
        <div className="text-muted-foreground text-[13px]">
          {linesCaption(range)}
        </div>
        <label className="block">
          <span className="sr-only">Comment</span>
          <textarea
            ref={area}
            rows={1}
            value={body}
            maxLength={MAX_COMMENT_BODY}
            placeholder={`Comment for ${agentName}`}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            className="placeholder:text-muted-foreground block w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-[1.4] outline-none"
          />
        </label>
        {shown && (
          <p role="alert" className="text-[13px] text-[var(--del)]">
            {shown}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn("pill pill-secondary", flow === "tray" && "pill-sm")}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text || busy}
            className={cn(
              "pill pill-primary disabled:opacity-50",
              flow === "tray" && "pill-sm"
            )}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {flow === "immediate" ? "Send to chat" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
