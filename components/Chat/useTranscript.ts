"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem } from "@/lib/claude-transcript";

const POLL_MS = 1500;

interface TranscriptResponse {
  sessionId?: string;
  items?: ChatItem[];
  offset?: number;
  start?: number;
  truncated?: boolean;
  reset?: boolean;
  notFound?: boolean;
  unsupported?: boolean;
}

/** `base` is the session's API path, or one of its subagents' */
export function useTranscript(base: string, active: boolean) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading"
  );
  // The base the state was last read for (the state lags a switch)
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const busy = useRef(false);
  const cursor = useRef<{ offset?: number; sid?: string; start?: number }>({});

  useEffect(() => {
    cursor.current = {};
    setItems([]);
    setState("loading");
    setSettledFor(null);
  }, [base]);

  // The page of history above what's shown
  const loadEarlier = useCallback(async () => {
    const { start, sid } = cursor.current;
    if (start === undefined || start <= 0 || busy.current) return;
    busy.current = true;
    setLoadingEarlier(true);
    try {
      const res = await fetch(
        `${base}/transcript?before=${start}&sid=${sid ?? ""}`
      );
      const data: TranscriptResponse = await res.json();
      // A different Claude session now: the poll will start over
      if (!data.items || data.reset || cursor.current.start !== start) return;
      cursor.current.start = data.start;
      setItems((prev) => [...data.items!, ...prev]);
      setTruncated(!!data.truncated);
    } catch {
      // Try again on the next scroll up
    } finally {
      busy.current = false;
      setLoadingEarlier(false);
    }
  }, [base]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const { offset, sid } = cursor.current;
      const qs =
        offset === undefined ? "" : `?since=${offset}&sid=${sid ?? ""}`;
      try {
        const res = await fetch(`${base}/transcript${qs}`);
        const data: TranscriptResponse = await res.json();
        if (stopped) return;
        if (data.notFound || data.unsupported || !data.items) {
          setState("missing");
          setSettledFor(base);
        } else {
          const fresh = offset === undefined || data.reset;
          cursor.current = {
            ...cursor.current,
            offset: data.offset,
            sid: data.sessionId,
          };
          if (fresh) {
            cursor.current.start = data.start;
            setItems(data.items);
            setTruncated(!!data.truncated);
          } else if (data.items.length) {
            setItems((prev) => [...prev, ...data.items!]);
          }
          setState("ready");
          setSettledFor(base);
        }
      } catch {
        // Keep what we have; try again next tick
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [base, active]);

  return { items, state, settledFor, truncated, loadEarlier, loadingEarlier };
}
