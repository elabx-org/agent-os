"use client";

import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import { usePanes } from "@/contexts/PaneContext";
import { useDeleteSession } from "@/data/sessions";
import { isUntouched, type FreshUse } from "@/lib/bg-send";
import type { QueueState } from "@/lib/queue/types";
import { bgSendStore, forgetFresh } from "@/stores/bgSend";

/** What happened in the session; throws when it can't be told */
async function readUse(sessionId: string): Promise<FreshUse> {
  const base = `/api/sessions/${sessionId}`;
  const [transcript, queue] = await Promise.all([
    fetch(`${base}/transcript`).then((res) => {
      if (!res.ok) throw new Error("transcript");
      return res.json() as Promise<{
        items?: unknown[];
        notFound?: boolean;
        unsupported?: boolean;
      }>;
    }),
    fetch(`${base}/queue`).then((res) => {
      if (!res.ok) throw new Error("queue");
      return res.json() as Promise<QueueState>;
    }),
  ]);
  // Codex and Gemini have no transcript to read: what was typed in their
  // terminal is unknown, so they stay
  if (transcript.unsupported) throw new Error("unsupported");
  return {
    sent: !!bgSendStore.fresh[sessionId]?.sent,
    hasTranscript: !transcript.notFound && (transcript.items?.length ?? 0) > 0,
    queued: (queue.items?.length ?? 0) > 0 || (queue.failed?.length ?? 0) > 0,
  };
}

/**
 * Mounted once by the page with the focused pane's session. When the user
 * moves off a fresh session (stores/bgSend.ts) that is untouched
 * (lib/bg-send.ts isUntouched), it is stopped and deleted, so repeated
 * background sends don't litter Now.
 */
export function useFreshSessionCleanup(
  focusedSessionId: string | undefined
): void {
  const { fresh } = useSnapshot(bgSendStore);
  const { state } = usePanes();
  const deleteSession = useDeleteSession();
  const deleteRef = useRef(deleteSession.mutateAsync);
  deleteRef.current = deleteSession.mutateAsync;

  // Every session in a tab of any pane: one still in a tab is not left
  const open = new Set<string>();
  if (focusedSessionId) open.add(focusedSessionId);
  for (const pane of Object.values(state.panes)) {
    for (const tab of pane.tabs) if (tab.sessionId) open.add(tab.sessionId);
  }
  const openKey = [...open].sort().join(",");
  const openRef = useRef(open);
  openRef.current = open;

  // Fresh sessions seen open: one is only left after it was shown (it is
  // marked fresh just before the page attaches it)
  const seen = useRef(new Set<string>());
  const checking = useRef(new Set<string>());

  useEffect(() => {
    for (const id of Object.keys(fresh)) {
      if (openRef.current.has(id)) {
        seen.current.add(id);
        continue;
      }
      if (!seen.current.has(id) || checking.current.has(id)) continue;
      checking.current.add(id);
      void (async () => {
        try {
          const use = await readUse(id);
          if (!isUntouched(use)) {
            forgetFresh(id);
            seen.current.delete(id);
            return;
          }
          // Back in it while this was read, or no longer fresh
          if (openRef.current.has(id) || !bgSendStore.fresh[id]) return;
          const stop = await fetch(`/api/sessions/${id}/stop`, {
            method: "POST",
          });
          if (!stop.ok) return;
          await deleteRef.current(id);
          forgetFresh(id);
          seen.current.delete(id);
        } catch {
          // Can't tell what happened in it: keep it (tried again when it
          // is left next time)
        } finally {
          checking.current.delete(id);
        }
      })();
    }
  }, [fresh, openKey]);
}
