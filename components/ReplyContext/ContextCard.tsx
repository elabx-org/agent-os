"use client";

import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeMark } from "@/components/UsagePill";
import type { ReplyContext } from "@/lib/reply-context";

// Small buttons that still take a 44px touch
const HIT = "relative after:absolute after:-inset-x-2 after:-inset-y-3";

interface ContextCardProps {
  context: ReplyContext;
  /** One line: the draft has grown, or there's little room above */
  collapsed: boolean;
  /** The card's body: the whole turn in the reply sheet */
  onOpen: () => void;
  onJump?: () => void;
  /** Put away until Claude's next turn */
  onDismiss: () => void;
}

/**
 * What you're replying to, pinned above the composer while you type: the
 * label, the question in bold and a short excerpt. Tap it for the whole turn.
 */
export function ContextCard({
  context,
  collapsed,
  onOpen,
  onJump,
  onDismiss,
}: ContextCardProps) {
  const { label, question, excerpt } = context;
  const headline = question ?? (collapsed ? excerpt : null);

  return (
    <div
      // Keeps the box focused, so the keyboard stays up
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "bg-card border-border animate-in fade-in relative mx-1 mb-1.5 rounded-2xl border duration-150",
        collapsed ? "px-3 py-1.5" : "px-3 pt-2 pb-2.5"
      )}
    >
      {/* The body opens the sheet; the buttons sit over it */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label}: show the whole message`}
        className="absolute inset-0 rounded-2xl"
      />
      {collapsed ? (
        <div className="pointer-events-none relative flex min-h-[24px] items-center gap-2">
          <ClaudeMark size={11} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
            {headline || label}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground h-3.5 w-3.5 shrink-0"
          />
          <DismissButton onDismiss={onDismiss} />
        </div>
      ) : (
        <>
          <div className="pointer-events-none relative flex items-center gap-1.5">
            <ClaudeMark size={11} />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.08em] uppercase">
              {label}
            </span>
            {onJump && (
              <button
                type="button"
                onClick={onJump}
                className={cn(
                  HIT,
                  "text-muted-foreground hover:text-foreground pointer-events-auto shrink-0 text-[11px]"
                )}
              >
                Jump to it ↑
              </button>
            )}
            <DismissButton onDismiss={onDismiss} />
          </div>
          <div className="pointer-events-none relative pr-4">
            {headline && (
              <p className="mt-1 line-clamp-2 text-[13px] leading-snug font-semibold">
                {headline}
              </p>
            )}
            {excerpt && excerpt !== headline && (
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[12px] leading-snug">
                {excerpt}
              </p>
            )}
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground absolute right-0 bottom-0 h-3.5 w-3.5"
            />
          </div>
        </>
      )}
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Hide until Claude's next turn"
      title="Hide until Claude's next turn"
      className={cn(
        HIT,
        "text-muted-foreground hover:text-foreground pointer-events-auto -mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      )}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
