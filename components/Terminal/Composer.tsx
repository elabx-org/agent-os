"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionsQuery } from "@/data/sessions";
import {
  ComposerChips,
  ComposerInput,
  ComposerPopover,
  useComposer,
} from "@/components/Composer";
import {
  ClaudeStateBar,
  QueuedMessages,
  StrayInput,
  RewindSheet,
  useClaudeLive,
  type ClaudeKey,
} from "@/components/Composer/ClaudeStateBar";
import { ReplyContextBar } from "@/components/ReplyContext";
import type { SpreadPages } from "@/components/views/SessionSpread";
import { ComposerPlusMenu } from "./ComposerPlusMenu";

const MAX_ROWS = 5;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** The session typed into: its folder and agent drive the pickers */
  sessionId?: string | null;
  /** Called with the text to send; empty text means "press Enter" */
  onSend: (text: string) => void;
  /** Hand the keyboard to the terminal (Claude Code's / and @ pickers) */
  onTypeInTerminal: () => void;
  onPhoto: () => void;
  onSelectText: () => void;
  /** A control beside the send button (the keybar toggle) */
  extra?: React.ReactNode;
  /** The terminal's visible rows, where Claude draws its state */
  readScreen?: () => readonly string[] | null;
  /** Shift+Tab, Esc and the rest, straight to Claude */
  onClaudeKey?: (key: ClaudeKey, times?: number) => void;
  /** What this composer sent that Claude holds until its turn ends */
  getQueued?: () => string[];
  onEditQueued?: () => void;
  onCancelQueued?: () => void;
  /** Text in Claude's own box, which the composer hides */
  stray?: string | null;
  onMoveStray?: () => void;
  onClearStray?: () => void;
  /** Hidden behind another tab or view: Claude's state isn't read */
  active?: boolean;
  /** Claude's state on a slim line above the box, not under it (the open
      Duo's split row, level with the keys on the other page) */
  stateAbove?: boolean;
  /** Across both pages of the open Duo (Two rows): the box on the left
      page, its buttons and Claude's state on the right one */
  pages?: SpreadPages | null;
}

/**
 * Multi-line text box pinned above the keybar on touch devices. Native iOS
 * editing (selection, autocorrect, dictation) and the text stays visible above
 * the keyboard, instead of typing blind into xterm's hidden textarea.
 */
export function Composer({
  value,
  onChange,
  sessionId,
  onSend,
  onTypeInTerminal,
  onPhoto,
  onSelectText,
  extra,
  readScreen,
  onClaudeKey,
  getQueued,
  onEditQueued,
  onCancelQueued,
  stray,
  onMoveStray,
  onClearStray,
  active = true,
  stateAbove = false,
  pages,
}: ComposerProps) {
  const { data } = useSessionsQuery();
  const session = sessionId
    ? data?.sessions.find((s) => s.id === sessionId)
    : undefined;
  const composer = useComposer({
    value,
    onChange,
    sessionId,
    cwd: session?.working_directory,
    claude: session?.agent_type === "claude",
  });
  const { textareaRef, display } = composer;
  // Claude's mode, spinner and status line, mirrored under the box
  const live = useClaudeLive({
    sessionId,
    claude: composer.claude,
    active,
    readScreen,
    sendKey: onClaudeKey,
  });
  // Once the text needs a second line, the buttons move under it and the
  // text gets the whole width. It stays that way until the box is empty, so
  // the wider box fitting the text on one line again doesn't flip it back.
  const [stacked, setStacked] = useState(false);
  // On a page of its own the box keeps its row
  const stack = stacked && !pages;

  // Grow with content up to MAX_ROWS, then scroll
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingY =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    if (!display) setStacked(false);
    else if (!stacked && el.scrollHeight > lineHeight * 1.5 + paddingY)
      setStacked(true);
    const padding = el.offsetHeight - el.clientHeight + 16;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + padding)}px`;
  }, [display, stacked]);

  // A snippet, file path or dictation joins what's typed, a space apart
  const insert = (text: string) => {
    if (!text) return;
    composer.insert(text, true);
  };

  const send = () => {
    // The draft holds the pills' full text: that's what goes
    onSend(composer.text);
    onChange("");
    composer.sent();
  };

  const sendButton = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={send}
      // The one accent control on screen, also when it just presses Enter
      className="bg-primary text-primary-foreground flex h-[44px] w-[44px] flex-shrink-0 touch-manipulation items-center justify-center rounded-full active:opacity-80"
      aria-label={value ? "Send" : "Press Enter"}
      title={value ? "Send" : "Press Enter"}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );

  return (
    // z-10: the capsule's backdrop blur makes it a layer of its own, which
    // otherwise sits under xterm's canvases, so taps on the + menu and the
    // pickers that open above the box went to the terminal
    // Two rows: the box ends where the left page does (less its margin)
    <div
      className="relative z-10 mx-2.5 my-1.5"
      style={pages ? { width: pages.left - 10 } : undefined}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <ComposerPopover composer={composer} />
      <RewindSheet live={live} cwd={composer.cwd} />
      <QueuedMessages
        live={live}
        known={getQueued?.()}
        onEdit={onEditQueued}
        onCancel={onCancelQueued}
      />
      {stray && onMoveStray && onClearStray && (
        <StrayInput text={stray} onMove={onMoveStray} onClear={onClearStray} />
      )}
      {/* What's being answered, and the passages quoted to answer */}
      <ReplyContextBar
        composer={composer}
        sessionId={sessionId}
        view="terminal"
      />
      <ComposerChips composer={composer} />
      {stateAbove && !pages && (
        <ClaudeStateBar live={live} className="pt-0 pb-1 pl-3" />
      )}
      <div
        className={cn(
          // Glass-like capsule, as the control column
          "bg-background/70 border-border flex items-end gap-1.5 rounded-[28px] border p-1.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)] backdrop-blur-xl backdrop-saturate-150",
          stack && "flex-wrap"
        )}
      >
        <ComposerPlusMenu
          onPhoto={onPhoto}
          onInsert={insert}
          onSelectText={onSelectText}
          onTypeInTerminal={onTypeInTerminal}
          onHistory={
            composer.claude && composer.cwd
              ? () => composer.setHistoryOpen(true)
              : undefined
          }
          onRewind={live.claude ? () => live.setRewindOpen(true) : undefined}
        />
        <ComposerInput
          composer={composer}
          onKeyDown={(e) => {
            if (live.onKeyDown(e)) return;
            // Return sends, Shift+Return adds a line. On the on-screen keyboard
            // the keybar's newline key adds a line instead.
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
          }}
          data-composer=""
          enterKeyHint="send"
          placeholder="Type into the terminal"
          autoCapitalize="sentences"
          className={cn("flex-1", stack && "order-first basis-full")}
        />
        {stack && <span className="flex-1" aria-hidden="true" />}
        {!pages && extra}
        {!pages && sendButton}
      </div>
      {pages ? (
        // On the right page, level with the box: Claude's state, then the
        // keybar toggle and send at the far end
        <div
          className="absolute bottom-0 flex items-end gap-1.5 py-1.5"
          style={{
            left: `calc(100% + ${pages.gutter}px)`,
            width: pages.right - 10,
          }}
        >
          <ClaudeStateBar
            live={live}
            className="min-w-0 flex-1 self-center p-0"
          />
          <div className="ml-auto flex shrink-0 items-end gap-1.5">
            {extra}
            {sendButton}
          </div>
        </div>
      ) : (
        !stateAbove && <ClaudeStateBar live={live} />
      )}
    </div>
  );
}
