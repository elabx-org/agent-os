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
  RewindSheet,
  useClaudeLive,
  type ClaudeKey,
} from "@/components/Composer/ClaudeStateBar";
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
    readScreen,
    sendKey: onClaudeKey,
  });
  // Once the text needs a second line, the buttons move under it and the
  // text gets the whole width. It stays that way until the box is empty, so
  // the wider box fitting the text on one line again doesn't flip it back.
  const [stacked, setStacked] = useState(false);

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

  return (
    <div
      className="relative mx-2.5 my-1.5"
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
      <ComposerChips composer={composer} />
      <div
        className={cn(
          // Glass-like capsule, as the control column
          "bg-background/70 border-border flex items-end gap-1.5 rounded-[28px] border p-1.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08)] backdrop-blur-xl backdrop-saturate-150",
          stacked && "flex-wrap"
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
          className={cn("flex-1", stacked && "order-first basis-full")}
        />
        {stacked && <span className="flex-1" aria-hidden="true" />}
        {extra}
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
      </div>
      <ClaudeStateBar live={live} />
    </div>
  );
}
