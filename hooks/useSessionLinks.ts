"use client";

import { useEffect, useRef } from "react";
import { onNativeEvent } from "@/lib/native-bridge";
import {
  findSessionElsewhere,
  followLink,
  tabMachine,
} from "@/lib/client/machine";
import { isElsewhere, linkTarget, parseKeptLink } from "@/lib/machine-marker";
import type { Session } from "@/lib/db";

/** How long a link waits for its session here before asking elsewhere */
const ELSEWHERE_MS = 2000;

/**
 * Opens the session a notification points at: `?session=<id>` in a browser,
 * or an `open` event from the iOS app (agentos://session/<id>). Waits for the
 * session list when the link arrives before it has loaded. A session on a
 * linked machine (the link says which, or it's found there) moves the tab.
 */
export function useSessionLinks(
  sessions: Session[],
  /** false: not ready yet (no terminal to open it in), try again shortly */
  open: (session: Session) => boolean | void
) {
  const pending = useRef<string | null>(null);
  const tries = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  const tryOpen = useRef((list: Session[]) => {
    const id = pending.current;
    if (!id) return;
    const session = list.find((s) => s.id === id);
    if (!session) return;
    if (openRef.current(session) === false) {
      // Up to ~10s for the first terminal to mount
      if ((tries.current += 1) <= 40)
        setTimeout(() => tryOpen.current(sessionsRef.current), 250);
      return;
    }
    pending.current = null;
    tries.current = 0;
  });
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A link to a session, perhaps saying where it runs
    const follow = (id: string | null | undefined, target: string | null) => {
      if (!id) return;
      if (isElsewhere(target, tabMachine())) return followLink(target!, id);
      pending.current = id;
      tryOpen.current(sessionsRef.current);
      // Not here: it may be on another linked machine (or back on this
      // server, when the tab is on one)
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (pending.current !== id) return;
        if (sessionsRef.current.some((s) => s.id === id)) return;
        const where = await findSessionElsewhere(id);
        if (where && pending.current === id) followLink(where, id);
      }, ELSEWHERE_MS);
    };

    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("session");
    if (fromUrl) {
      url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
    }
    // A link that launched the app arrives before the page could listen
    const kept = window.agentosNative?.open;
    if (window.agentosNative) window.agentosNative.open = undefined;
    if (kept) {
      const link = parseKeptLink(kept);
      follow(link.session, link.target);
    } else {
      // "?machine=" was already taken by the tab (lib/client/machine.ts)
      follow(fromUrl, null);
    }

    const off = onNativeEvent((event) => {
      if (event.type !== "open") return;
      if (window.agentosNative) window.agentosNative.open = undefined;
      follow(event.sessionId, linkTarget(event.machineId));
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  useEffect(() => {
    tryOpen.current(sessions);
  }, [sessions]);
}
