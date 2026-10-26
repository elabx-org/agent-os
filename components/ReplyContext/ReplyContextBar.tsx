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
import { useReplyContext } from "@/hooks/useReplyContext";
import type { ComposerEngine } from "@/components/Composer";
import { ContextCard } from "./ContextCard";
import { QuoteChips } from "./QuoteChips";
import { ReplySheet } from "./ReplySheet";
import { roomAbove } from "./layout";
import {
  dismissCard,
  jumpTo,
  replyContextStore,
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
  const context = useReplyContext(sessionId, typing || sheetOpen);
  const elsewhere = useContextShownElsewhere(sessionId);
  const { dismissed } = useSnapshot(replyContextStore);

  // Claude's next turn (or the next state of this one) brings it back
  const turn = context
    ? `${context.kind}:${context.sourceId ?? ""}:${context.ts ?? ""}`
    : "";
  const showCard =
    typing &&
    !!context &&
    !!sessionId &&
    !elsewhere &&
    !sheetOpen &&
    dismissed[sessionId] !== turn;

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
