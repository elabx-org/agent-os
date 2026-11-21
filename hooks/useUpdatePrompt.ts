"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { canReloadNow } from "@/lib/auto-reload";
import { isChunkFailure, reloadOnce } from "@/lib/chunk-error";

const POLL_MS = 60_000;
/** While an update waits for a moment that costs the user nothing */
const WAIT_MS = 3000;

const FIELDS =
  'textarea, input:not([type]), input[type="text"], input[type="search"], [contenteditable="true"]';
const OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const textOf = (el: Element) =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
    ? el.value
    : (el.textContent ?? "");

/** Nothing typed, nothing open, and the user away or leaving it alone */
function quietMoment(lastTouch: number): boolean {
  const active = document.activeElement;
  return canReloadNow({
    hidden: document.visibilityState === "hidden",
    // The terminal's own hidden field never holds a draft
    draft: [...document.querySelectorAll(FIELDS)].some(
      (el) =>
        !el.classList.contains("xterm-helper-textarea") &&
        textOf(el).trim() !== ""
    ),
    overlay: document.querySelector(OVERLAYS) !== null,
    typing: !!active && active !== document.body && active.matches(FIELDS),
    idleMs: Date.now() - lastTouch,
  });
}

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
 * reloaded. It reloads itself at the first moment that costs the user
 * nothing (lib/auto-reload.ts) and offers the reload until then; at once
 * when a code file it needs is already gone (lib/chunk-error.ts).
 */
export function useUpdatePrompt() {
  useEffect(() => {
    let loaded: string | null = null;
    let shown = false;
    let lastTouch = Date.now();
    let waiting: ReturnType<typeof setInterval> | null = null;
    const touched = () => {
      lastTouch = Date.now();
    };
    const reloadWhenQuiet = () => {
      if (!shown || !quietMoment(lastTouch)) return;
      location.reload();
    };
    const check = async () => {
      if (shown) return;
      const build = await fetchBuild();
      if (!build) return;
      if (!loaded) loaded = build.id;
      else if (build.id !== loaded) {
        shown = true;
        if (quietMoment(lastTouch)) return location.reload();
        waiting = setInterval(reloadWhenQuiet, WAIT_MS);
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
      else reloadWhenQuiet();
    };
    window.addEventListener("pointerdown", touched, true);
    window.addEventListener("keydown", touched, true);
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
      if (waiting) clearInterval(waiting);
      window.removeEventListener("pointerdown", touched, true);
      window.removeEventListener("keydown", touched, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}
