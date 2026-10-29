"use client";

import { useEffect, useRef } from "react";
import { useProjectConfig } from "@/hooks/useProjectConfig";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { useScriptRunner } from "@/components/Projects/useScriptRunner";
import {
  isReservedShortcut,
  matchesShortcut,
  parseShortcut,
} from "@/lib/script-shortcuts";
import { openScripts } from "@/stores/scriptsSheet";

function fromTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(".xterm");
}

/** A field you type in (useViewShortcuts' test): xterm's textarea isn't one */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm")) return false;
  return (
    target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    (target.tagName === "INPUT" &&
      !["checkbox", "radio", "button", "submit", "range"].includes(
        (target as HTMLInputElement).type
      ))
  );
}

/**
 * M3 (U3.2): the current project's script shortcuts (Cmd+Shift+T etc.)
 * run their script, as the Scripts sheet's play would. Mounted next to
 * useViewShortcuts in app/page.tsx; the project is the active session's.
 *
 * In a text field only shortcuts with Cmd (Ctrl) count, so Alt and Shift
 * keep typing; in the terminal only Cmd+Shift ones, as plain Ctrl keys are
 * the shell's. A file that isn't approved yet opens the Scripts sheet,
 * where play asks.
 */
export function useScriptShortcuts(
  projectId: string | null | undefined,
  sessionId: string | null | undefined
): void {
  const { data } = useProjectConfig(projectId);
  const { run } = useScriptRunner(projectId, sessionId);
  const latest = useRef({
    scripts: data?.config.scripts,
    run,
    projectId,
    sessionId,
  });
  latest.current = { scripts: data?.config.scripts, run, projectId, sessionId };

  const hasShortcuts = !!data?.config.scripts?.some((s) => s.shortcut);

  useEffect(() => {
    if (!hasShortcuts) return;
    const mac = isMacLike();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const { scripts, run, projectId, sessionId } = latest.current;
      if (!projectId || !scripts) return;
      for (const script of scripts) {
        const spec = parseShortcut(script.shortcut);
        if (!spec || isReservedShortcut(spec)) continue;
        if (!matchesShortcut(e, spec, mac)) continue;
        if (isTextInput(e.target) && !spec.mod) return;
        if (fromTerminal(e.target) && !(spec.mod && spec.shift)) return;
        e.preventDefault();
        e.stopPropagation();
        void run(script, {
          announce: true,
          onUntrusted: () => openScripts(projectId, sessionId),
        });
        return;
      }
    };
    // Capture, so a focused editor or xterm can't swallow it first
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hasShortcuts]);
}
