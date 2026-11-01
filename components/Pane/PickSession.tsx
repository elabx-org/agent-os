"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { SquareTerminal } from "lucide-react";
import type { Session } from "@/lib/db";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { STATE_DOT_CLASS } from "@/lib/agent-state";
import { pausedLast, sessionState } from "@/lib/paused";
import { mobileNavStore } from "@/stores/mobileNav";
import { cn } from "@/lib/utils";

const MAX_SESSIONS = 8;
// A tab that is about to attach (a queued pick, a reload) is bare for a
// moment: the list waits this long so it doesn't flash
const SHOW_AFTER_MS = 600;

export interface PickSessionProps {
  sessions: Session[];
  onPick: (sessionId: string) => void;
  /** "Open a terminal": the plain shell underneath */
  onShell: () => void;
}

/**
 * A pane with no session: the latest sessions to open in it, or the plain
 * shell it already has
 */
export function PickSession({ sessions, onPick, onShell }: PickSessionProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  const { statuses } = useSnapshot(mobileNavStore);
  // Paused (handed-off) and settled ones after the live ones
  const recent = pausedLast(
    [...sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  ).slice(0, MAX_SESSIONS);
  const titles = useListTitles(recent);
  if (!shown) return null;

  return (
    <div className="bg-background absolute inset-0 z-20 flex flex-col items-center overflow-y-auto px-4 py-8">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="t-title">Pick a session</h2>
          <p className="text-muted-foreground text-[13px]">
            Nothing is open in this pane yet.
          </p>
        </div>
        {recent.length > 0 && (
          <div className="group-card">
            {recent.map((session, i) => {
              const { title } = displayTitle(session, titles);
              const state = sessionState(session, statuses[session.id]?.status);
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onPick(session.id)}
                  className={cn(
                    "row min-h-12 w-full text-left",
                    i > 0 && "border-t border-[var(--hair)]"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-[7px] w-[7px] shrink-0 rounded-full",
                      STATE_DOT_CLASS[state]
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={onShell}
          className="pill pill-secondary self-start"
        >
          <SquareTerminal className="h-4 w-4" aria-hidden="true" />
          Open a terminal
        </button>
      </div>
    </div>
  );
}
