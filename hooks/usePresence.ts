"use client";

import { useEffect, useRef } from "react";

const CLIENT_KEY = "agentos:client-id";
const BEAT_MS = 20_000;

function clientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

/**
 * Tells the server which session this page shows while it is on screen, so
 * phone notifications skip the session you are already looking at.
 */
export function usePresence(sessionId: string | undefined) {
  const current = useRef(sessionId);
  current.current = sessionId;

  useEffect(() => {
    const id = clientId();
    const report = () => {
      const body = JSON.stringify({
        clientId: id,
        sessionId: current.current ?? null,
        visible: document.visibilityState === "visible",
      });
      // A beacon still goes out as the app moves to the background
      if (!navigator.sendBeacon?.("/api/push/presence", body)) {
        fetch("/api/push/presence", {
          method: "POST",
          body,
          keepalive: true,
        }).catch(() => {});
      }
    };
    report();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") report();
    }, BEAT_MS);
    document.addEventListener("visibilitychange", report);
    window.addEventListener("pagehide", report);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("pagehide", report);
    };
  }, []);

  // Report a session switch straight away
  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    fetch("/api/push/presence", {
      method: "POST",
      body: JSON.stringify({
        clientId: clientId(),
        sessionId: sessionId ?? null,
        visible: true,
      }),
    }).catch(() => {});
  }, [sessionId]);
}
