"use client";

import type { MutableRefObject } from "react";
import { cn } from "@/lib/utils";
import { useSessionsQuery } from "@/data/sessions";
import { useComposer } from "@/components/Composer";
import { ComposerCard } from "@/components/Composer/ComposerCard";
import {
  QueuedMessages,
  StrayInput,
  RewindSheet,
  useClaudeLive,
  type ClaudeKey,
} from "@/components/Composer/ClaudeStateBar";
import { ReplyContextBar } from "@/components/ReplyContext";
import { useQueue } from "@/hooks/useQueue";
import {
  getProviderDefinition,
  isValidProviderId,
} from "@/lib/providers/registry";
import type { SpreadPages } from "@/components/views/SessionSpread";
import { ComposerPlusMenu, type ComposerTools } from "./ComposerPlusMenu";

/** A one-line box: the 52px capsule and its margin. Growing up, the box
    keeps this much room in the row. */
const ONE_LINE_PX = 64;

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
  /** Across both pages of the open Duo (Two rows): the box on the left
      page, its buttons on the right one */
  pages?: SpreadPages | null;
  /** Its row stays one line tall and a longer box grows up over the
      terminal (the open Duo's Split and Mirrored: the other page keeps the
      terminal down to its keys, not an empty band beside the box) */
  growUp?: boolean;
  /** The key row above has the tools: no +, its actions through `toolsRef` */
  noPlus?: boolean;
  toolsRef?: MutableRefObject<ComposerTools | null>;
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
  pages,
  growUp = false,
  noPlus = false,
  toolsRef,
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
  // Claude's state: the queue, rewind and the box's keys follow it
  const live = useClaudeLive({
    sessionId,
    claude: composer.claude,
    active,
    readScreen,
    sendKey: onClaudeKey,
  });
  // The server queue, when it's on for this session; off, the old send
  // (and the terminal keeps its own record of what Claude holds)
  const queue = useQueue(sessionId ?? "", { enabled: !!sessionId && active });
  const agentName = !session
    ? "the agent"
    : session.agent_type === "claude"
      ? "Claude"
      : isValidProviderId(session.agent_type)
        ? getProviderDefinition(session.agent_type).name
        : session.agent_type;

  // A snippet, file path or dictation joins what's typed, a space apart
  const insert = (text: string) => {
    if (!text) return;
    composer.insert(text, true);
  };

  // The same elements either way: growUp flips with the layout (the
  // keyboard coming up can change it), and a remounted box loses focus,
  // which takes the keyboard down again
  return (
    <div
      className={cn(growUp && "relative")}
      style={growUp ? { height: ONE_LINE_PX } : undefined}
    >
      {/* Opaque: what grows up (the box, the queue, Claude's state) covers
          the terminal rather than mixing with its lines */}
      <div
        className={cn(growUp && "bg-background absolute inset-x-0 bottom-0")}
      >
        <ComposerCard
          composer={composer}
          sessionId={sessionId ?? ""}
          agentName={agentName}
          queue={queue}
          onSendDirect={onSend}
          // Nothing typed: Enter, as the terminal's own key
          onEmptySend={() => onSend("")}
          placeholder="Type into the terminal"
          live={live}
          // The terminal draws Claude's mode; history is in the +
          modePill={false}
          history={false}
          pages={pages}
          // z-10: the glass's backdrop blur makes it a layer of its own,
          // which otherwise sits under xterm's canvases, so taps on the +
          // menu and the pickers that open above the box went to the
          // terminal. Two rows: the box ends where the left page does
          className="z-10 mx-2.5 my-1.5"
          inputProps={{
            inputClassName: "max-h-36",
            // The terminal tells its own focus from the composer's by this
            ...({ "data-composer": "" } as object),
          }}
          plus={
            <ComposerPlusMenu
              onPhoto={onPhoto}
              videoDraft={sessionId}
              onInsert={insert}
              onSelectText={onSelectText}
              onTypeInTerminal={onTypeInTerminal}
              onHistory={
                composer.claude && composer.cwd
                  ? () => composer.setHistoryOpen(true)
                  : undefined
              }
              onRewind={
                live.claude ? () => live.setRewindOpen(true) : undefined
              }
              hidden={noPlus}
              toolsRef={toolsRef}
            />
          }
          trailing={extra}
          above={
            <>
              <RewindSheet live={live} cwd={composer.cwd} />
              {/* The queue on: QueueCard in the card shows what waits */}
              {!queue.enabled && (
                <QueuedMessages
                  live={live}
                  known={getQueued?.()}
                  onEdit={onEditQueued}
                  onCancel={onCancelQueued}
                />
              )}
              {stray && onMoveStray && onClearStray && (
                <StrayInput
                  text={stray}
                  onMove={onMoveStray}
                  onClear={onClearStray}
                />
              )}
              {/* What's being answered, and the passages quoted to answer */}
              <ReplyContextBar
                composer={composer}
                sessionId={sessionId}
                view="terminal"
              />
            </>
          }
        />
      </div>
    </div>
  );
}
