"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const POLL_MS = 60_000;

async function fetchBuild(): Promise<string | null> {
  try {
    const res = await fetch("/api/build", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

/**
 * After a deploy the open page keeps running the old build until it is
 * reloaded: offer the reload, never do it (a draft or a tap may be mid-way).
 */
export function useUpdatePrompt() {
  useEffect(() => {
    let loaded: string | null = null;
    let shown = false;
    const check = async () => {
      if (shown) return;
      const id = await fetchBuild();
      if (!id) return;
      if (!loaded) loaded = id;
      else if (id !== loaded) {
        shown = true;
        toast("Agent-OS updated", {
          id: "update",
          description: "Reload to use the new version.",
          duration: Infinity,
          // On the open Duo, on the right page instead of across the fold
          position: document.documentElement.hasAttribute("data-hinge")
            ? "top-right"
            : undefined,
          classNames: {
            actionButton: "!bg-primary !text-primary-foreground",
          },
          action: { label: "Reload", onClick: () => location.reload() },
        });
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
