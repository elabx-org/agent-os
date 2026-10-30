"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { isChunkFailure, reloadOnce } from "@/lib/chunk-error";

const POLL_MS = 60_000;

export interface Build {
  id: string;
  /** The release (0.5.3), or package.json's with the commit (0.5.0+1a2b3c4) */
  version?: string;
}

export async function fetchBuild(): Promise<Build | null> {
  try {
    const res = await fetch("/api/build", { cache: "no-store" });
    if (!res.ok) return null;
    const build = (await res.json()) as Partial<Build>;
    return build.id ? (build as Build) : null;
  } catch {
    return null;
  }
}

/**
 * After a deploy the open page keeps running the old build until it is
 * reloaded: offer the reload, never do it (a draft or a tap may be mid-way),
 * unless a code file it needs is already gone (lib/chunk-error.ts).
 */
export function useUpdatePrompt() {
  useEffect(() => {
    let loaded: string | null = null;
    let shown = false;
    const check = async () => {
      if (shown) return;
      const build = await fetchBuild();
      if (!build) return;
      if (!loaded) loaded = build.id;
      else if (build.id !== loaded) {
        shown = true;
        toast("AgentOS updated", {
          id: "update",
          description: build.version
            ? `Reload to use v${build.version}.`
            : "Reload to use the new version.",
          duration: Infinity,
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
    // Except when the old build's code is already gone: the page can't
    // go on, so reload now
    const onError = (e: ErrorEvent) => {
      if (isChunkFailure(e.error ?? e.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkFailure(e.reason)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}
