"use client";

import { useSnapshot } from "valtio";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useSessionsQuery } from "@/data/sessions/queries";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { getSessionView } from "@/lib/session-views";
import { STATE_DOT_CLASS } from "@/lib/agent-state";
import { pausedLast, sessionState } from "@/lib/paused";
import { isEnded } from "@/lib/settle-types";
import { mobileNavStore } from "@/stores/mobileNav";
import { openBeside } from "@/stores/beside";
import { cn } from "@/lib/utils";

const MAX_SESSIONS = 8;

/**
 * "Open beside": the most recent other sessions, each opening next to the
 * focused one in the view last used there
 */
export function BesideItems({ exclude }: { exclude?: string[] }) {
  const { data } = useSessionsQuery();
  const { statuses } = useSnapshot(mobileNavStore);
  // Paused (handed-off) and settled ones after the live ones
  const sessions = pausedLast(
    (data?.sessions ?? [])
      .filter((s) => !exclude?.includes(s.id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  ).slice(0, MAX_SESSIONS);
  const titles = useListTitles(sessions);

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
        Open beside
      </DropdownMenuLabel>
      {sessions.length === 0 && (
        <DropdownMenuItem disabled>No other sessions</DropdownMenuItem>
      )}
      {sessions.map((session) => {
        const { title } = displayTitle(session, titles);
        const state = sessionState(session, statuses[session.id]?.status);
        // A paused or settled one has no terminal to show: it opens in its chat
        const view = isEnded(session)
          ? "chat"
          : (getSessionView(session.id) ?? "terminal");
        return (
          <DropdownMenuItem
            key={session.id}
            onSelect={() => openBeside(session.id)}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-[7px] w-[7px] shrink-0 rounded-full",
                STATE_DOT_CLASS[state]
              )}
            />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {view === "chat" ? "Messages" : "Terminal"}
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
