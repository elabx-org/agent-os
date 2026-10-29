"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProxyConfig } from "@/hooks/useProxyConfig";
import { proxyUrlFor } from "@/lib/proxy-url";
import type { BrowserOpenEvent } from "@/lib/browser-open";

const POLL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Shows the links CLIs in sessions ask to open (sign-in pages, OAuth
 * callbacks on localhost) as toasts, polling /api/browser-open every 3s
 * while the tab is visible. Not a long poll: on plain HTTP/1.1 a held
 * request would take one of the browser's six connections per tab.
 * Only while the port proxy is on: off, sessions get no helper.
 */
export function BrowserOpenListener() {
  const config = useProxyConfig();
  const configRef = useRef(config);
  configRef.current = config;
  const enabled = config?.enabled === true;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let seq: number | null = null;
    let backoff = POLL_MS;
    let running = false;

    const show = (event: BrowserOpenEvent) => {
      const origin = window.location.origin;
      const proxy = configRef.current;
      const from = event.session ? `${event.session} · ` : "";
      if (event.kind === "loopback" && event.port) {
        const url = proxyUrlFor(event.port, event.path ?? "/", {
          origin,
          subdomainBase: proxy?.subdomainBase ?? null,
          enabled: proxy?.enabled ?? true,
        });
        toast("Open sign-in link", {
          id: `browser-open-${event.seq}`,
          description: `${from}${event.host}`,
          duration: Infinity,
          action: {
            label: "Open",
            onClick: () => window.open(url, "_blank", "noopener"),
          },
        });
        return;
      }
      const callback = event.callbackPort
        ? ` After signing in, if the browser lands on a localhost:${event.callbackPort} page that won't load, replace "http://localhost:${event.callbackPort}" with "${proxyUrlFor(event.callbackPort, "", { origin, subdomainBase: proxy?.subdomainBase ?? null, enabled: proxy?.enabled ?? true }).replace(/\/$/, "")}".`
        : "";
      toast("Open link", {
        id: `browser-open-${event.seq}`,
        description: `${from}${event.host}.${callback}`,
        duration: Infinity,
        action: {
          label: "Open",
          onClick: () => window.open(event.url, "_blank", "noopener"),
        },
      });
    };

    const loop = async () => {
      if (running) return;
      running = true;
      while (!stopped && document.visibilityState === "visible") {
        controller = new AbortController();
        try {
          const query = seq === null ? "" : `?after=${seq}`;
          const res = await fetch(`/api/browser-open${query}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`browser-open ${res.status}`);
          const data = (await res.json()) as {
            events: BrowserOpenEvent[];
            seq: number;
          };
          if (seq !== null) data.events.forEach(show);
          seq = data.seq;
          backoff = POLL_MS;
          await new Promise((r) => setTimeout(r, POLL_MS));
        } catch {
          if (stopped) break;
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        }
      }
      running = false;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void loop();
      else controller?.abort();
    };

    document.addEventListener("visibilitychange", onVisibility);
    void loop();
    return () => {
      stopped = true;
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return null;
}
