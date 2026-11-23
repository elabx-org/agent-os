"use client";

import { useMemo } from "react";
import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";
import { displayTitle, type useListTitles } from "@/hooks/useSessionTitles";
import { isPaused } from "@/lib/handoff-types";
import { HUB_TARGET } from "@/lib/machine-marker";
import { parseMovedTo } from "@/lib/session-move-types";
import { useMachines, useTabMachineId } from "@/data/machines";
import {
  openProjectContinueSheet,
  type ProjectChat,
} from "@/stores/continueSheet";

export interface AwayChats {
  machine: string;
  /** The machine's name when the chats left */
  name: string;
  chats: ProjectChat[];
}

/**
 * A project page's part in "Continue on another machine": the action for
 * its menu (undefined when there is nowhere to go), and the chats that
 * already went, by the machine they are on, with the way to bring them back
 */
export function useProjectContinue(
  project: { id: string; name: string; is_uncategorized: boolean },
  sessions: Session[],
  statuses: Record<string, SessionStatus>,
  titles: ReturnType<typeof useListTitles>
): {
  continueElsewhere?: () => void;
  away: AwayChats[];
  bringBack: (group: AwayChats) => void;
} {
  const { data } = useMachines();
  const mine = useTabMachineId() ?? HUB_TARGET;
  const offered =
    !!data?.enabled &&
    !project.is_uncategorized &&
    (mine !== HUB_TARGET || data.machines.some((m) => m.status === "approved"));

  const { here, away } = useMemo(() => {
    const here: ProjectChat[] = [];
    const groups = new Map<string, AwayChats>();
    for (const s of sessions) {
      if (s.agent_type === "shell") continue;
      const name = displayTitle(s, titles).title;
      const to = s.settled_reason === "moved" ? parseMovedTo(s.moved_to) : null;
      if (to) {
        // Continued from a copy while this machine was offline: its own bar
        if (to.takeover || to.machine === mine) continue;
        const group = groups.get(to.machine) ?? {
          machine: to.machine,
          name: to.name,
          chats: [],
        };
        group.chats.push({ id: s.id, name, blocked: null });
        groups.set(to.machine, group);
        continue;
      }
      here.push({
        id: s.id,
        name,
        blocked:
          (s.agent_type || "claude") !== "claude"
            ? "Only Claude chats can move"
            : isPaused(s)
              ? "Handed off to another chat"
              : statuses[s.id]?.status === "running"
                ? "Working now: stop it or wait for it to finish"
                : null,
      });
    }
    return { here, away: [...groups.values()] };
  }, [sessions, statuses, titles, mine]);

  return {
    continueElsewhere: offered
      ? () =>
          openProjectContinueSheet({
            id: project.id,
            name: project.name,
            chats: here,
          })
      : undefined,
    away,
    bringBack: (group) =>
      openProjectContinueSheet(
        { name: project.name, chats: group.chats },
        group.machine
      ),
  };
}
