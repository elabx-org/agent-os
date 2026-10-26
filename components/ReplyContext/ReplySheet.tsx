"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { ClaudeMark } from "@/components/UsagePill";
import type { ReplyContext } from "@/lib/reply-context";
import { AnswerChips } from "./AnswerChips";
import { roomAbove, roomBelow } from "./layout";

// Pulled down this far, the sheet goes
const SWIPE_CLOSE_PX = 80;
// With less room than this above the composer (a floating keyboard puts it
// at the top), the sheet opens below it instead
const MIN_ROOM_PX = 200;

interface ReplySheetProps {
  context: ReplyContext;
  sessionId: string;
  /** The view the sheet covers; else the composer's clipping ancestor */
  bounds?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onJump?: () => void;
  /** "Other…": the draft takes the answer */
  onOther: () => void;
}

/**
 * Claude's whole last turn, over the session and above the composer, with
 * the question's options as chips. The composer under it stays the same box
 * (same draft, keyboard up). Swipe down, the grabber or Esc puts it away.
 */
export function ReplySheet({
  context,
  sessionId,
  bounds,
  onClose,
  onJump,
  onOther,
}: ReplySheetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [below, setBelow] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragFrom = useRef<number | null>(null);

  // Fills the room above the composer (what it's positioned on), which
  // moves with the keyboard
  useLayoutEffect(() => {
    const box = rootRef.current?.offsetParent;
    if (!(box instanceof HTMLElement)) return;
    const measure = () => {
      const above = roomAbove(box, bounds?.current);
      const under = roomBelow(box, bounds?.current);
      const flip = above < MIN_ROOM_PX && under > above;
      setBelow(flip);
      setHeight(flip ? under : above);
    };
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => {
      vv?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [bounds]);

  // Opens at the end, where the question is
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [context.text, context.question, height]);

  // Esc closes it, before the box's own Esc (which would go to Claude)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const asks = context.kind === "ask" || context.kind === "permission";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Replying to Claude"
      // Keeps the box focused, so the keyboard stays up
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "bg-background border-border animate-in fade-in absolute -inset-x-2.5 z-40 flex flex-col overflow-hidden duration-200",
        below
          ? "motion-safe:slide-in-from-top-6 top-full rounded-b-2xl border-b shadow-[0_12px_30px_rgb(0_0_0/0.25)]"
          : "motion-safe:slide-in-from-bottom-6 bottom-full rounded-t-2xl border-t shadow-[0_-12px_30px_rgb(0_0_0/0.25)]",
        height === undefined && "invisible"
      )}
      style={{
        height,
        transform: drag ? `translateY(${drag}px)` : undefined,
      }}
    >
      {/* The handle: drag it down, or tap the grabber */}
      <div
        className="shrink-0 touch-none px-3 pb-1.5"
        onTouchStart={(e) => {
          dragFrom.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (dragFrom.current === null) return;
          setDrag(Math.max(0, e.touches[0].clientY - dragFrom.current));
        }}
        onTouchEnd={() => {
          dragFrom.current = null;
          if (drag > SWIPE_CLOSE_PX) onClose();
          else setDrag(0);
        }}
        onTouchCancel={() => {
          dragFrom.current = null;
          setDrag(0);
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the session"
          className="mx-auto flex h-5 w-16 items-center justify-center"
        >
          <span className="bg-muted-foreground/40 h-1 w-9 rounded-full" />
        </button>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold">Replying to Claude</h2>
          <span className="text-muted-foreground ml-auto text-[11px] pointer-fine:hidden">
            Swipe down to go back
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground ml-auto text-[11px] pointer-coarse:hidden"
          >
            Esc to go back
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <ClaudeMark size={11} />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.08em] uppercase">
              {context.label}
            </span>
            {onJump && (
              <button
                type="button"
                onClick={onJump}
                className="text-muted-foreground hover:text-foreground relative shrink-0 text-[11px] after:absolute after:-inset-x-2 after:-inset-y-3"
              >
                Jump to it ↑
              </button>
            )}
          </div>
          {context.text && (
            <div className="border-border text-muted-foreground border-l-2 pl-3">
              <Markdown text={context.text} className="text-[13px]" />
            </div>
          )}
          {asks && context.question && (
            <p className="text-[13.5px] leading-snug font-semibold">
              {context.question}
            </p>
          )}
          {context.kind === "permission" && context.excerpt && (
            <p className="text-muted-foreground text-[12px]">
              {context.excerpt}
            </p>
          )}
          <AnswerChips
            context={context}
            sessionId={sessionId}
            onAnswered={onClose}
            onOther={onOther}
            className="pt-1"
          />
        </div>
      </div>
    </div>
  );
}
