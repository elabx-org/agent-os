"use client";

import { useMemo } from "react";
import { Plus, Sun, Terminal } from "lucide-react";
import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { STATE_DOT_CLASS, STATE_WORD, sessionState } from "@/lib/agent-state";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { runNav } from "@/lib/nav-actions";
import { cn } from "@/lib/utils";
import { railSessions } from "./model";

export interface AvatarRailProps {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  /** Sessions showing in a pane: ringed in the accent */
  shownIds: string[];
  /** Panes showing a plain shell (no session): a ringed >_ tile each */
  shells?: { paneId: string; name: string }[];
  onOpenSession: (session: Session) => void;
  onFocusPane?: (paneId: string) => void;
  onNewSession: () => void;
}

/** The rail's width (Desk-Beside) */
export const AVATAR_RAIL_WIDTH = 72;

/**
 * Desk-Beside: the sidebar collapsed while two panes are open. New on
 * top, an agent tile per session on screen or needing you or working, with
 * its state dot, and the open shells; what's on screen is ringed. Settings
 * at the bottom.
 */
export function AvatarRail({
  sessions,
  sessionStatuses,
  shownIds,
  shells = [],
  onOpenSession,
  onFocusPane,
  onNewSession,
}: AvatarRailProps) {
  const live = useMemo(
    () => railSessions(sessions, sessionStatuses, shownIds),
    [sessions, sessionStatuses, shownIds]
  );
  const titles = useListTitles(live);

  return (
    <nav
      aria-label="Sessions"
      className="bg-page flex h-full flex-col items-center gap-3 border-r border-[var(--hair)] py-[18px]"
    >
      <button
        type="button"
        onClick={onNewSession}
        aria-label="New session"
        className="bg-primary flex h-10 w-10 flex-none items-center justify-center rounded-xl text-white active:opacity-80"
      >
        <Plus className="h-5 w-5" />
      </button>
      <div aria-hidden className="bg-foreground/10 h-px w-7 flex-none" />

      <div className="-my-1 flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-y-auto py-1">
        {live.map((s) => {
          const state = sessionState(s, sessionStatuses[s.id]?.status);
          const { title } = displayTitle(s, titles);
          const dot = state === "needs" || state === "work";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenSession(s)}
              aria-label={`${title}, ${STATE_WORD[state].toLowerCase()}`}
              title={title}
              className={cn(
                "relative flex-none rounded-xl active:opacity-80",
                shownIds.includes(s.id) &&
                  "shadow-[0_0_0_2px_hsl(var(--primary))]"
              )}
            >
              <Avatar {...agentAvatar(s.agent_type)} />
              {dot && (
                <span
                  aria-hidden
                  className={cn(
                    "border-page absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2",
                    STATE_DOT_CLASS[state]
                  )}
                />
              )}
            </button>
          );
        })}
        {shells.map((shell) => (
          <button
            key={shell.paneId}
            type="button"
            onClick={() => onFocusPane?.(shell.paneId)}
            aria-label={`${shell.name}, shell`}
            title={shell.name}
            className="relative flex-none rounded-xl shadow-[0_0_0_2px_hsl(var(--primary))] active:opacity-80"
          >
            <Avatar label=">_" tone="shell" icon={Terminal} />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => runNav("settings")}
        aria-label="Settings"
        className="hover:bg-accent flex h-11 w-11 flex-none items-center justify-center rounded-full"
      >
        <Sun className="h-5 w-5" />
      </button>
    </nav>
  );
}
