"use client";

import { useEffect, useRef } from "react";
import { onNativeEvent } from "@/lib/native-bridge";
import type { Session } from "@/lib/db";

/**
 * Opens the session a notification points at: `?session=<id>` in a browser,
 * or an `open` event from the iOS app (agentos://session/<id>). Waits for the
 * session list when the link arrives before it has loaded.
 */
export function useSessionLinks(
  sessions: Session[],
  open: (session: Session) => void
) {
  const pending = useRef<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const tryOpen = useRef((list: Session[]) => {
    const id = pending.current;
    if (!id) return;
    const session = list.find((s) => s.id === id);
    if (!session) return;
    pending.current = null;
    openRef.current(session);
  });
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("session");
    if (fromUrl) {
      url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
    }
    // A link that launched the app arrives before the page could listen
    pending.current = window.agentosNative?.open ?? fromUrl;
    if (window.agentosNative) window.agentosNative.open = undefined;
    tryOpen.current(sessionsRef.current);

    return onNativeEvent((event) => {
      if (event.type !== "open") return;
      pending.current = event.sessionId;
      if (window.agentosNative) window.agentosNative.open = undefined;
      tryOpen.current(sessionsRef.current);
    });
  }, []);

  useEffect(() => {
    tryOpen.current(sessions);
  }, [sessions]);
}
