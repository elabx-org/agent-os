"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useSnapshot } from "valtio";
import { useQuery } from "@tanstack/react-query";
import { useReplyContext } from "@/hooks/useReplyContext";
import { statusKeys } from "@/data/sessions/keys";
import type { SessionStatus } from "@/components/views/types";
import type { ComposerEngine } from "@/components/Composer";
import { AskCard } from "./AskCard";
import { ChoiceCard } from "./ChoiceCard";
import { ContextCard } from "./ContextCard";
import { QuoteChips } from "./QuoteChips";
import { ReplySheet } from "./ReplySheet";
import { roomAbove } from "./layout";
import {
  dismissCard,
  jumpTo,
  replyContextStore,
  setTyping,
  useContextShownElsewhere,
} from "./store";
import { useTypingReply } from "./useTyping";

// Past this many lines of draft the card keeps to one line
const COLLAPSE_LINES = 2;
// With less room than this above the box, the card keeps to one line
const COLLAPSE_ROOM_PX = 160;

interface ReplyContextBarProps {
  composer: ComposerEngine;
  sessionId: string | null | undefined;
  /** Where "Jump to it" goes: Chat scrolls, Terminal switches to Chat */
  view: "terminal" | "chat";
  /** The view the reply sheet covers; else the composer's clipping ancestor */
  bounds?: RefObject<HTMLElement | null>;
}

/**
 * Above the composer, inside its (positioned) wrapper: the context card while
 * typing on a touch screen, the reply sheet it opens, and the quote chips.
 */
export function ReplyContextBar({
  composer,
  sessionId,
  view,
  bounds,
}: ReplyContextBarProps) {
  const typing = useTypingReply(composer.focused);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The app's status poll says when Claude waits on you: then a question
  // shows as the answer card without typing first
  const { data: statuses } = useQuery<{
    statuses: Record<string, SessionStatus>;
  }>({ queryKey: statusKeys.all, enabled: false });
  const status = sessionId ? statuses?.statuses[sessionId]?.status : undefined;
  const waiting = status === "waiting";
  // Done with its turn: a question in its message may want a reply
  const settled = waiting || status === "idle";
  const context = useReplyContext(sessionId, typing || sheetOpen || settled);
  // Claude's question on screen, with all its questions known
  const asking =
    !!sessionId &&
    context?.kind === "ask" &&
    !!context.questions?.length &&
    !!context.onScreen;
  const elsewhere = useContextShownElsewhere(sessionId);
  const { dismissed } = useSnapshot(replyContextStore);

  // Claude's next turn (or the next state of this one) brings it back
  const turn = context
    ? `${context.kind}:${context.sourceId ?? ""}:${context.ts ?? ""}`
    : "";
  const showCard =
    !asking &&
    typing &&
    !!context &&
    !!sessionId &&
    !elsewhere &&
    !sheetOpen &&
    dismissed[sessionId] !== turn;
  // A question asked in Claude's message, with replies to tap
  const choosing =
    !!sessionId &&
    settled &&
    !typing &&
    !sheetOpen &&
    !elsewhere &&
    context?.kind === "message" &&
    !!context.choices &&
    dismissed[sessionId] !== `choices:${turn}`;

  // Layouts around the pane make room for the context while this is on
  useEffect(() => {
    if (!sessionId || !typing) return;
    setTyping(sessionId, true);
    return () => setTyping(sessionId, false);
  }, [sessionId, typing]);

  useEffect(() => setSheetOpen(false), [sessionId]);
  useEffect(() => {
    if (!context || elsewhere) setSheetOpen(false);
  }, [context, elsewhere]);

  // One line once the draft runs past two lines or the room above is short.
  // The room is measured under the card: the composer sits at the bottom, so
  // that point stays put whatever the card's height.
  const [collapsed, setCollapsed] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { textareaRef, display } = composer;
  useLayoutEffect(() => {
    const el = textareaRef.current;
    const anchor = anchorRef.current;
    if (!showCard || !el || !anchor) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingY =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const lines = Math.round((el.scrollHeight - paddingY) / lineHeight);
    const short = roomAbove(anchor, bounds?.current) < COLLAPSE_ROOM_PX;
    setCollapsed(lines > COLLAPSE_LINES || short);
  }, [showCard, display, bounds, textareaRef]);

  // The answer card covers the view above the composer, up to its top
  const [askRoom, setAskRoom] = useState<number | undefined>(undefined);
  // The replies sit above the terminal's key row, which stays in reach:
  // they're offered after most turns, not only when Claude waits on you
  const [keysLift, setKeysLift] = useState(0);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!(asking || choosing) || !anchor) return;
    const measure = () => {
      const keys = anchor
        .closest(".fold-controls")
        ?.querySelector<HTMLElement>(".keybar-row");
      const top = anchor.getBoundingClientRect().top;
      const keysTop = keys?.getBoundingClientRect().top ?? top;
      const lift = choosing && keysTop < top ? Math.round(top - keysTop) : 0;
      setKeysLift(lift);
      setAskRoom(Math.max(160, roomAbove(anchor, bounds?.current) - 8 - lift));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [asking, choosing, bounds]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const focusDraft = useCallback(() => {
    setSheetOpen(false);
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [textareaRef]);

  const sourceId = context?.sourceId;
  const jump =
    sessionId && sourceId
      ? () => {
          setSheetOpen(false);
          // Down goes the keyboard, so the item can be seen; the draft stays
          textareaRef.current?.blur();
          jumpTo(sessionId, sourceId, { switchView: view === "terminal" });
        }
      : undefined;

  return (
    <>
      {sheetOpen && context && sessionId && (
        <ReplySheet
          context={context}
          sessionId={sessionId}
          bounds={bounds}
          onClose={closeSheet}
          onJump={jump}
          onOther={focusDraft}
        />
      )}
      {asking && context.questions && (
        // Over the terminal, not above it in the flow: squeezing the pane
        // would make Claude redraw its question into a row or two
        <div
          className="absolute inset-x-0 bottom-full z-20"
          style={{ maxHeight: askRoom }}
        >
          <AskCard
            sessionId={sessionId}
            questions={context.questions}
            maxHeight={askRoom}
          />
        </div>
      )}
      {choosing && context.choices && (
        <div
          className="absolute inset-x-0 bottom-full z-20"
          style={{ maxHeight: askRoom, marginBottom: keysLift }}
        >
          <ChoiceCard
            // A new question starts afresh
            key={turn}
            sessionId={sessionId}
            choices={context.choices}
            maxHeight={askRoom}
            onDone={() => dismissCard(sessionId, `choices:${turn}`)}
          />
        </div>
      )}
      {showCard && (
        <ContextCard
          context={context}
          collapsed={collapsed}
          onOpen={() => setSheetOpen(true)}
          onJump={jump}
          onDismiss={() => dismissCard(sessionId, turn)}
        />
      )}
      <span ref={anchorRef} aria-hidden="true" className="block" />
      <QuoteChips sessionId={sessionId} />
    </>
  );
}
