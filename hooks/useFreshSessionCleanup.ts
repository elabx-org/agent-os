"use client";

import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import { usePanes } from "@/contexts/PaneContext";
import { useDeleteSession, useSessionsQuery } from "@/data/sessions";
import { usePreference } from "@/data/preferences/queries";
import {
  isUntouched,
  transcriptUse,
  type FreshUse,
  type TranscriptAnswer,
} from "@/lib/bg-send";
import { FLAGS_PREFERENCE_KEY, parseFlags } from "@/lib/flag-names";
import type { QueueState } from "@/lib/queue/types";
import type { ClaudeScreen } from "@/lib/claude-screen";
import { isAutoSessionName } from "@/lib/session-names";
import { bgSendStore, forgetFresh } from "@/stores/bgSend";
import { videosFor } from "@/stores/videoUploads";

/** Codex and Gemini: what was typed in their terminal can't be read */
class Unsupported extends Error {}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  return res.json() as Promise<T>;
}

/** This browser's copy of the composer: unsent text, attached sessions */
function localDraft(sessionId: string): boolean {
  try {
    const raw = localStorage.getItem(`agentos:draft:${sessionId}`);
    const text = raw ? (JSON.parse(raw) as { text?: unknown }).text : "";
    if (typeof text === "string" && text.trim()) return true;
    const attached = localStorage.getItem(`agentos:attached:${sessionId}`);
    return !!attached && attached !== "[]";
  } catch {
    return false;
  }
}

/**
 * What happened in the session; throws when it can't be told (the session
 * is then kept), Unsupported for Codex and Gemini
 */
async function readUse(sessionId: string, named: boolean): Promise<FreshUse> {
  const base = `/api/sessions/${sessionId}`;
  const [transcript, queue, draft, screen] = await Promise.all([
    json<TranscriptAnswer>(`${base}/transcript`),
    json<QueueState>(`${base}/queue`),
    json<{ text?: string }>(`${base}/draft`),
    json<{ screen: ClaudeScreen | null }>(`${base}/screen`),
  ]);
  const used = transcriptUse(transcript);
  if (used === "unsupported") throw new Unsupported();
  // Not located (the pane's lookup failed, or the read did): it may well
  // have a conversation, so it stays
  if (used === "unknown") throw new Error("transcript");
  return {
    sent: !!bgSendStore.fresh[sessionId]?.sent,
    hasTranscript: used,
    queued: (queue.items?.length ?? 0) > 0 || (queue.failed?.length ?? 0) > 0,
    draft:
      !!draft.text?.trim() ||
      localDraft(sessionId) ||
      videosFor(sessionId).length > 0,
    named,
    working: !!screen.screen?.spinner || !!screen.screen?.hasQueued,
  };
}

/**
 * Mounted once by the page with the focused pane's session. When the user
 * moves off a fresh session (stores/bgSend.ts) that is untouched
 * (lib/bg-send.ts isUntouched), it is stopped and deleted, so repeated
 * background sends don't litter Now. Labs flag bgSendCleanup off (or the
 * flags not loaded yet): fresh sessions are kept.
 */
export function useFreshSessionCleanup(
  focusedSessionId: string | undefined
): void {
  const { fresh } = useSnapshot(bgSendStore);
  const { state } = usePanes();
  const deleteSession = useDeleteSession();
  const deleteRef = useRef(deleteSession.mutateAsync);
  deleteRef.current = deleteSession.mutateAsync;
  const flags = usePreference<unknown>(FLAGS_PREFERENCE_KEY, null);
  const enabled = flags.isSuccess && parseFlags(flags.data).bgSendCleanup;
  const { data: sessionsData } = useSessionsQuery();
  const sessionsRef = useRef(sessionsData?.sessions);
  sessionsRef.current = sessionsData?.sessions;

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
      if (!enabled || !seen.current.has(id) || checking.current.has(id))
        continue;
      const done = () => {
        forgetFresh(id);
        seen.current.delete(id);
      };
      const row = sessionsRef.current?.find((s) => s.id === id);
      // Gone already (deleted elsewhere): nothing to remove
      if (sessionsRef.current && !row) {
        done();
        continue;
      }
      checking.current.add(id);
      void (async () => {
        try {
          const named = !!row && !isAutoSessionName(row.name);
          const use = await readUse(id, named);
          if (!isUntouched(use)) {
            done();
            return;
          }
          // Back in it while this was read, or no longer fresh
          if (openRef.current.has(id) || !bgSendStore.fresh[id]) return;
          const stop = await fetch(`/api/sessions/${id}/stop`, {
            method: "POST",
          });
          if (!stop.ok) return;
          await deleteRef.current(id);
          done();
        } catch (error) {
          // Codex, Gemini: kept, and not read again
          if (error instanceof Unsupported) done();
          // Otherwise it can't be told what happened in it: kept (tried
          // again when it is left next time)
        } finally {
          checking.current.delete(id);
        }
      })();
    }
  }, [fresh, openKey, enabled]);
}
