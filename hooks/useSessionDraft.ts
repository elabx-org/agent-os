"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SAVE_DELAY = 500;
const POLL_INTERVAL = 3000;

interface CachedDraft {
  text: string;
  /** Server time of the version this text is based on */
  serverAt: number;
  /** Typed here and not saved to the server yet */
  pending: boolean;
}

const cacheKey = (id: string) => `agentos:draft:${id}`;

function readCache(id: string): CachedDraft | null {
  try {
    const raw = localStorage.getItem(cacheKey(id));
    return raw ? (JSON.parse(raw) as CachedDraft) : null;
  } catch {
    return null;
  }
}

function writeCache(id: string, draft: CachedDraft) {
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify(draft));
  } catch {
    // Private mode or full: the server copy still works
  }
}

/**
 * The unsent text in a session's message box. It's kept on the server, so it
 * survives a reload and shows up on the user's other devices, and in
 * localStorage, so it's back instantly and isn't lost offline. Last save wins;
 * a change from another device is taken only while nothing typed here is
 * waiting to be saved. Without a session it's plain state.
 */
export function useSessionDraft(sessionId: string | null | undefined) {
  const [text, setTextState] = useState("");
  const textRef = useRef("");
  const serverAtRef = useRef(0);
  const pendingRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(sessionId);
  idRef.current = sessionId;

  const apply = useCallback((value: string) => {
    textRef.current = value;
    setTextState(value);
  }, []);

  const save = useCallback(async (keepalive = false) => {
    const id = idRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!id || !pendingRef.current || savingRef.current) return;
    savingRef.current = true;
    const sent = textRef.current;
    try {
      const res = await fetch(`/api/sessions/${id}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sent }),
        keepalive,
      });
      if (!res.ok || idRef.current !== id) return;
      const { updatedAt } = (await res.json()) as { updatedAt: number };
      serverAtRef.current = updatedAt;
      // Typed more while it was saving: that goes in the next save
      if (textRef.current === sent) pendingRef.current = false;
      writeCache(id, {
        text: textRef.current,
        serverAt: updatedAt,
        pending: pendingRef.current,
      });
    } catch {
      // Offline: stays pending and goes with the next change or poll
    } finally {
      savingRef.current = false;
      if (pendingRef.current && idRef.current === id && !timerRef.current)
        timerRef.current = setTimeout(() => save(), SAVE_DELAY);
    }
  }, []);

  const setText = useCallback(
    (value: string | ((prev: string) => string)) => {
      const next = typeof value === "function" ? value(textRef.current) : value;
      if (next === textRef.current) return;
      apply(next);
      const id = idRef.current;
      if (!id) return;
      pendingRef.current = true;
      writeCache(id, {
        text: next,
        serverAt: serverAtRef.current,
        pending: true,
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => save(), SAVE_DELAY);
    },
    [apply, save]
  );

  // Take the server's copy if another device changed it since
  const pull = useCallback(async () => {
    const id = idRef.current;
    if (!id || pendingRef.current || savingRef.current) return;
    try {
      const res = await fetch(`/api/sessions/${id}/draft`);
      if (!res.ok) return;
      const remote = (await res.json()) as { text: string; updatedAt: number };
      if (idRef.current !== id || pendingRef.current) return;
      if (remote.updatedAt <= serverAtRef.current) return;
      serverAtRef.current = remote.updatedAt;
      apply(remote.text);
      writeCache(id, {
        text: remote.text,
        serverAt: remote.updatedAt,
        pending: false,
      });
    } catch {
      // Try again on the next poll
    }
  }, [apply]);

  // A different session: its cached text right away, then the server's
  useEffect(() => {
    if (!sessionId) {
      serverAtRef.current = 0;
      pendingRef.current = false;
      return;
    }
    const cached = readCache(sessionId);
    serverAtRef.current = cached?.serverAt ?? 0;
    pendingRef.current = cached?.pending ?? false;
    apply(cached?.text ?? "");
    // Left unsaved by a reload or going offline
    if (pendingRef.current) save();
    else pull();
    return () => {
      // Switching away saves what's waiting for the session being left
      if (pendingRef.current && timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        fetch(`/api/sessions/${sessionId}/draft`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textRef.current }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [sessionId, apply, save, pull]);

  // Poll while the page is showing; save before it's hidden or closed
  useEffect(() => {
    if (!sessionId) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") pull();
    }, POLL_INTERVAL);
    const onVisibility = () => {
      if (document.visibilityState === "visible") pull();
      else save(true);
    };
    const onHide = () => save(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("focus", pull);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("focus", pull);
    };
  }, [sessionId, pull, save]);

  return [text, setText] as const;
}
