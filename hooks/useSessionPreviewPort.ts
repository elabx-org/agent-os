"use client";

import { useEffect } from "react";
import { useRunning } from "@/components/Running/data";
import { useMacApp } from "@/hooks/useMacHost";
import { sessionPort } from "@/lib/session-preview";
import { runningStore } from "@/stores/running";

const POLL_MS = 10_000;

/**
 * Keeps runningStore.previewPort: whether the session in front started a
 * web server, so its header and More can offer Preview. Not inside the Mac
 * app, whose toolbar always has the tab.
 */
export function useSessionPreviewPort(sessionId: string | null | undefined) {
  const mac = useMacApp();
  const watching = !!sessionId && !mac;
  const { data } = useRunning(POLL_MS, watching);
  const port = watching ? sessionPort(data ?? [], sessionId) : null;
  useEffect(() => {
    runningStore.previewPort = port;
    return () => {
      runningStore.previewPort = null;
    };
  }, [port]);
}
