"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { ClaudeMark } from "@/components/UsagePill";
import { useQuoteMenu } from "@/components/QuoteMenu";
import { useReplyContext } from "@/hooks/useReplyContext";
import { useQuotes, type Quote } from "@/stores/replyQuotes";
import { AnswerChips } from "./AnswerChips";
import { jumpTo, setContextShownElsewhere, useReplying } from "./store";

// Small buttons that still take a 44px touch
const HIT = "relative after:absolute after:-inset-x-2 after:-inset-y-3";
// Shorter than this, a quote or a block would match too much
const MIN_MATCH = 6;

/** Text to compare a quote with a rendered block: no Markdown, one case */
function normalize(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Marks the blocks a quote was taken from (or that hold the quote) */
function markQuoted(root: HTMLElement, quotes: readonly Quote[]) {
  const wanted = quotes
    .map((q) => normalize(q.text))
    .filter((q) => q.length >= MIN_MATCH);
  for (const block of root.querySelectorAll<HTMLElement>("[data-quote]")) {
    const text = normalize(block.textContent ?? "");
    const quoted =
      text.length >= MIN_MATCH &&
      wanted.some((q) => text.includes(q) || q.includes(text));
    if (quoted) block.dataset.quoted = "";
    else delete block.dataset.quoted;
  }
}

/** Gives the box back its focus (the keyboard stays up): "Other…" types */
function keepTyping() {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
}

interface ContextPanelProps {
  sessionId: string;
  /** Where "Jump to it" goes: Chat scrolls, Terminal switches to Chat */
  view: "terminal" | "chat";
  /** On the tabletop: back to the live terminal / chat */
  onShowLive?: () => void;
  /** Runs to the screen's top and bottom edges: clear of the iOS app's
   * status strip and the home indicator */
  edges?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Claude's whole last turn, held still beside or above the reply being
 * typed (the open Duo's left page, the tabletop's top half): the passages
 * quoted highlighted, the question's options as chips, "Jump to it".
 */
export function ContextPanel({
  sessionId,
  view,
  onShowLive,
  edges,
  className,
  style,
}: ContextPanelProps) {
  const context = useReplyContext(sessionId, true);
  const quotes = useQuotes(sessionId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Hold a block here to quote it too; the box keeps its focus
  const quoteMenu = useQuoteMenu({ sessionId, onQuoted: keepTyping });

  const text = context?.text ?? "";
  useLayoutEffect(() => {
    if (bodyRef.current) markQuoted(bodyRef.current, quotes);
  }, [text, quotes]);

  // Opens at the end, where the question is
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, context?.question]);

  const sourceId = context?.sourceId;
  const jump = sourceId
    ? () => {
        // Down goes the keyboard (and this layout with it); the draft stays
        (document.activeElement as HTMLElement | null)?.blur();
        jumpTo(sessionId, sourceId, { switchView: view === "terminal" });
      }
    : undefined;

  const asks = context?.kind === "ask" || context?.kind === "permission";
  // The page is the turn, whatever it ends in (as in the mock); only a
  // turn still running says so
  const label =
    context?.kind === "working" ? context.label : "Claude's last turn";

  return (
    <section
      aria-label="Claude's last turn"
      // Keeps the box focused, so the keyboard stays up
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "bg-background animate-in fade-in flex min-h-0 flex-col duration-200",
        className
      )}
      style={style}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 px-4 pt-3 pb-2",
          edges &&
            "[html[data-native]_&]:pt-[calc(0.75rem+env(safe-area-inset-top))]"
        )}
      >
        <Lock
          aria-hidden="true"
          className="text-muted-foreground h-3 w-3 shrink-0"
        />
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.08em] uppercase">
          {label}
        </span>
        {onShowLive && (
          <button
            type="button"
            onClick={onShowLive}
            className={cn(
              HIT,
              "text-muted-foreground hover:text-foreground shrink-0 text-[11px]"
            )}
          >
            {view === "terminal" ? "Show terminal" : "Show chat"}
          </button>
        )}
        {jump && (
          <button
            type="button"
            onClick={jump}
            className={cn(
              HIT,
              "text-muted-foreground hover:text-foreground ml-2 shrink-0 text-[11px]"
            )}
          >
            Jump to it ↑
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        {...quoteMenu.handlers}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3",
          edges && "pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        )}
      >
        <div className="flex flex-col gap-2.5">
          {!context ? (
            <p className="text-muted-foreground text-[13px]">
              Nothing from Claude yet
            </p>
          ) : (
            <>
              {text && (
                <div
                  ref={bodyRef}
                  className="[&_[data-quoted]]:bg-secondary [&_[data-quoted]]:outline-border [&_[data-quoted]]:rounded-md [&_[data-quoted]]:outline [&_[data-quoted]]:outline-offset-2"
                >
                  <Markdown text={text} className="text-[13px]" quotable />
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
                onOther={keepTyping}
                className="pt-1"
              />
            </>
          )}
        </div>
      </div>
      {quoteMenu.menu}
    </section>
  );
}

interface DeckContextProps {
  sessionId: string | null | undefined;
  view: "terminal" | "chat";
  /** The tabletop's top half is showing (the deck is laid out) */
  on: boolean;
  /** What the panel lays over: the live output above the fold */
  cover: RefObject<HTMLElement | null>;
}

/**
 * The tabletop while typing: Claude's last turn over the live terminal or
 * chat above the fold (laid over it, so the terminal never remounts and
 * keeps its scrollback), with a way back to the live view. Render it in a
 * positioned ancestor of `cover`.
 */
export function DeckContext({ sessionId, view, on, cover }: DeckContextProps) {
  const replying = useReplying(sessionId);
  // A shell session has no Claude turn to show: the live view stays
  const context = useReplyContext(sessionId, on && replying);
  const [live, setLive] = useState(false);
  const active = on && replying && !!sessionId && !!context;
  const show = active && !live;

  // The next reply starts with the context again
  useEffect(() => {
    if (!active) setLive(false);
  }, [active]);

  useEffect(() => {
    if (!show || !sessionId) return;
    setContextShownElsewhere(sessionId, true);
    return () => setContextShownElsewhere(sessionId, false);
  }, [show, sessionId]);

  // Where the cover sits within the positioned ancestor
  const anchorRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const measure = useCallback(() => {
    const el = cover.current;
    const host = anchorRef.current?.offsetParent;
    if (!el || !host) return setBox(null);
    const a = el.getBoundingClientRect();
    const b = host.getBoundingClientRect();
    setBox({
      top: a.top - b.top,
      left: a.left - b.left,
      width: a.width,
      height: a.height,
    });
  }, [cover]);
  useLayoutEffect(() => {
    const el = cover.current;
    if (!active || !el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, cover, measure]);

  if (!active || !sessionId) return null;
  return (
    <div
      ref={anchorRef}
      className="pointer-events-none absolute z-30"
      style={box ?? { visibility: "hidden" }}
    >
      {show ? (
        <ContextPanel
          sessionId={sessionId}
          view={view}
          onShowLive={() => setLive(true)}
          className="pointer-events-auto h-full"
        />
      ) : (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLive(false)}
          className="bg-secondary/90 text-muted-foreground hover:text-foreground pointer-events-auto absolute top-2 right-3 flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium shadow-md backdrop-blur pointer-coarse:h-11"
        >
          <ClaudeMark size={11} />
          Claude&rsquo;s turn
        </button>
      )}
    </div>
  );
}
