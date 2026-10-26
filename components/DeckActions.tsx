"use client";

import { useState } from "react";
import {
  GitBranch,
  Loader2,
  MessageSquare,
  Square,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mobileNavActions, type PaneViewMode } from "@/stores/mobileNav";
import type { SessionStatus } from "@/components/views/types";

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

const BUTTON =
  "bg-secondary text-foreground active:bg-accent flex h-12 min-w-0 items-center justify-center gap-2 rounded-xl text-sm font-medium disabled:opacity-40";

/**
 * The tabletop base's first row, nearest the work above: Stop, Changes, and
 * Terminal or Chat
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
          BUTTON,
          // Red only while there is something to stop
          running && "border border-red-500/40 text-red-400"
        )}
      >
        {stopping ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Square className="h-4 w-4 fill-current" />
        )}
        Stop
      </button>
      <button type="button" onClick={() => show("git")} className={BUTTON}>
        <GitBranch className="h-4 w-4" />
        Changes
      </button>
      <button type="button" onClick={() => show(other)} className={BUTTON}>
        <OtherIcon className="h-4 w-4" />
        {other === "chat" ? "Chat" : "Terminal"}
      </button>
    </div>
  );
}
