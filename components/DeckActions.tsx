"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import {
  GitBranch,
  Loader2,
  MessageSquare,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  mobileNavActions,
  mobileNavStore,
  type PaneViewMode,
} from "@/stores/mobileNav";
import type { SessionStatus } from "@/components/views/types";
import { useAnswerPrompt, useSessionPrompt } from "@/data/prompts/queries";
import { splitOptions } from "@/lib/permission-card";

/** Esc to Claude in the session's pane: stops what it's doing */
export async function interruptSession(sessionId: string) {
  await fetch(`/api/sessions/${sessionId}/interrupt`, { method: "POST" });
}

interface DeckActionsProps {
  sessionId: string;
  status: SessionStatus["status"] | undefined;
  /** The view showing now: the third button switches to the other one */
  view: "terminal" | "chat";
  /** Defaults to interruptSession, with its own spinner */
  onStop?: () => void;
  stopping?: boolean;
  /** Defaults to asking the focused pane for that view */
  onView?: (mode: PaneViewMode) => void;
  className?: string;
}

// The fold deck's pills: 52px, big enough to hit from across the table
const PILL = "pill pill-secondary h-[52px] min-w-0 rounded-[26px] px-3";

/**
 * The tabletop base's first row, nearest the work above: Stop, Changes, and
 * Terminal or Chat, as pills
 */
export function DeckActions({
  sessionId,
  status,
  view,
  onStop,
  stopping: stoppingProp,
  onView,
  className,
}: DeckActionsProps) {
  const [ownStopping, setOwnStopping] = useState(false);
  const stopping = stoppingProp ?? ownStopping;
  const running = status === "running";

  const stop = async () => {
    if (onStop) return onStop();
    setOwnStopping(true);
    try {
      await interruptSession(sessionId);
    } finally {
      setOwnStopping(false);
    }
  };
  const show = (mode: PaneViewMode) =>
    onView ? onView(mode) : mobileNavActions.requestViewMode(mode, sessionId);

  const other = view === "chat" ? "terminal" : "chat";
  const OtherIcon = other === "chat" ? MessageSquare : SquareTerminal;

  return (
    <div className={cn("grid shrink-0 grid-cols-3 gap-2", className)}>
      <button
        type="button"
        onClick={stop}
        disabled={!running || stopping}
        className={cn(
          PILL,
          "disabled:opacity-40",
          // Red only while there is something to stop
          running && "text-red-600 dark:text-[#FCA5A5]"
        )}
      >
        {stopping ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span aria-hidden className="h-3 w-3 rounded-[3px] bg-current" />
        )}
        Stop
      </button>
      <button type="button" onClick={() => show("git")} className={PILL}>
        <GitBranch className="h-4 w-4" />
        Changes
      </button>
      <button type="button" onClick={() => show(other)} className={PILL}>
        <OtherIcon className="h-4 w-4" />
        {other === "chat" ? "Chat" : "Terminal"}
      </button>
    </div>
  );
}

/**
 * Fold-Terminal's answers on the base while a prompt shows: "1 · Yes"
 * filled, "2 · No" quiet, numbered as the terminal numbers them. The other
 * options are the key grid's ↑ ↓ ⏎ away. Nothing without a prompt
 */
export function DeckAnswers({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { statuses } = useSnapshot(mobileNavStore);
  const waiting = statuses[sessionId]?.status === "waiting";
  const { data: prompt } = useSessionPrompt(sessionId, { enabled: waiting });
  const { answer, answering, error } = useAnswerPrompt(sessionId);
  if (!waiting || !prompt?.options.length) return null;
  const { main } = splitOptions(prompt.options);

  return (
    <div className={cn("flex shrink-0 flex-col gap-1", className)}>
      <div className="flex gap-2">
        {main.map((option, i) => (
          <button
            key={`${option.index}-${option.label}`}
            type="button"
            title={option.label}
            disabled={answering !== null}
            onClick={() => answer(option)}
            className={cn(
              "pill h-14 min-w-0 flex-1 touch-manipulation rounded-2xl text-[17px] disabled:opacity-60",
              i === 0 && option.kind !== "deny"
                ? "pill-primary"
                : "pill-secondary"
            )}
          >
            {answering === option.index && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            )}
            <span className="truncate">
              {prompt.options.indexOf(option) + 1} · {option.label}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
