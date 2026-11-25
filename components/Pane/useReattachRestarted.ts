"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { statusKeys } from "@/data/sessions/keys";
import { fetchStatuses } from "@/data/statuses/queries";
import {
  afterReattach,
  seeStarted,
  GONE_WATCH_MS,
  TERMINAL_ENDED_EVENT,
  type Attached,
} from "@/lib/reattach";
import { backgroundAgentOfTmux } from "@/lib/background-tmux";
import { isEnded } from "@/lib/settle-types";
import type { Session } from "@/lib/db";
import type { PaneData } from "@/lib/panes";
import type { TerminalHandle } from "@/components/Terminal";

const TICK_MS = 3000;

/**
 * A session restarted from somewhere else (another device, an agent, the
 * hub) leaves this pane's terminal at its shell's prompt under "[exited]".
 * Once the session runs again its tab attaches by itself: the server types
 * the attach only at the shell's prompt, so a tab that shows it already
 * (this page restarted it) is left alone. It never starts a session.
 */
export function useReattachRestarted({
  paneDataRef,
  terminals,
  sessions,
  tmuxSetup,
}: {
  paneDataRef: RefObject<PaneData>;
  terminals: RefObject<Map<string, TerminalHandle | null>>;
  sessions: Session[];
  tmuxSetup: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
  });
  const statusesRef = useRef(data?.statuses);
  statusesRef.current = data?.statuses;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const setupRef = useRef(tmuxSetup);
  setupRef.current = tmuxSetup;

  const known = useRef(new Map<string, Attached>());
  const gone = useRef(new Map<string, number>());
  const asking = useRef(new Set<string>());
  // A terminal here just printed that its session ended
  const endedAt = useRef(0);

  const check = useCallback(
    (tick: boolean) => {
      const statuses = statusesRef.current;
      if (!statuses) return;
      const now = Date.now();
      const tabs = paneDataRef.current.tabs;
      let watch = now - endedAt.current < GONE_WATCH_MS;
      for (const tab of tabs) {
        const { id, sessionId, attachedTmux } = tab;
        if (
          !sessionId ||
          !attachedTmux ||
          backgroundAgentOfTmux(attachedTmux)
        ) {
          known.current.delete(id);
          gone.current.delete(id);
          continue;
        }
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        // Paused or settled: its tmux ended for good
        if (!session || isEnded(session)) continue;
        const started = statuses[sessionId]?.started;
        const { next, reattach } = seeStarted(
          known.current.get(id),
          sessionId,
          started
        );
        known.current.set(id, next);
        if (started === undefined) {
          // Ended a moment ago: a restart brings it back soon
          if (next.started !== undefined) {
            const since = gone.current.get(id) ?? now;
            gone.current.set(id, since);
            if (now - since < GONE_WATCH_MS) watch = true;
          }
          continue;
        }
        gone.current.delete(id);
        if (!reattach || asking.current.has(id)) continue;
        const handle = terminals.current.get(id);
        if (!handle) continue;
        asking.current.add(id);
        const name = session.tmux_name || attachedTmux;
        handle
          .sendShellCommand(
            `${setupRef.current}; tmux attach -t ${name}`,
            false,
            true
          )
          .then((typed) => {
            const now = known.current.get(id);
            if (now && now.sessionId === sessionId) {
              known.current.set(id, afterReattach(now, typed, started));
            }
            // It shows again: no need to keep asking
            if (typed) endedAt.current = 0;
          })
          .finally(() => asking.current.delete(id));
      }
      for (const id of [...known.current.keys()]) {
        if (!tabs.some((t) => t.id === id)) {
          known.current.delete(id);
          gone.current.delete(id);
        }
      }
      if (tick && watch) {
        queryClient.invalidateQueries({ queryKey: statusKeys.all });
      }
    },
    [paneDataRef, terminals, queryClient]
  );

  // Each new status answer, and between them (an attach not typed yet, a
  // session that ended a moment ago)
  useEffect(() => check(false), [data, check]);
  useEffect(() => {
    const timer = setInterval(() => check(true), TICK_MS);
    const ended = () => {
      // Only a pane that shows a session has one to wait for
      if (paneDataRef.current.tabs.some((t) => t.sessionId && t.attachedTmux)) {
        endedAt.current = Date.now();
      }
    };
    window.addEventListener(TERMINAL_ENDED_EVENT, ended);
    return () => {
      clearInterval(timer);
      window.removeEventListener(TERMINAL_ENDED_EVENT, ended);
    };
  }, [check, paneDataRef]);
}
