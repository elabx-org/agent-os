"use client";

import { useEffect, useRef } from "react";
import { useSettle } from "@/hooks/useSettle";
import type { Session } from "@/lib/db";
import { showSettledToast } from "@/lib/undo";
import { freshAutoSettles, settleCaption } from "./settle-model";

const STORAGE_KEY = "agentos.autoSettleToasts";

/** Ids that had their toast, across reloads of this tab */
const shown = new Set<string>(readShown());

function readShown(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(id: string) {
  shown.add(id);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...shown].slice(-50)));
  } catch {
    // Private mode or blocked storage: this page load still remembers
  }
}

/**
 * A toast with Undo, once, for each session auto-settle took in the last
 * two minutes (its PR merged): "Deck state line fix settled · PR #106
 * merged". Undo unsettles it, which relaunches the agent.
 */
export function useAutoSettleToasts(
  sessions: Session[],
  titleOf: (session: Session) => string
) {
  const { unsettle } = useSettle();
  // Read when a toast shows: the titles change without the sessions doing so
  const title = useRef(titleOf);
  title.current = titleOf;
  useEffect(() => {
    for (const session of freshAutoSettles(sessions, shown, Date.now())) {
      remember(session.id);
      showSettledToast({
        title: title.current(session),
        caption: settleCaption(session),
        undo: () => unsettle(session),
      });
    }
  }, [sessions, unsettle]);
}
