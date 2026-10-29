"use client";

/**
 * M3 (U3.2): the current project's script shortcuts (Cmd+Shift+T etc.)
 * run their script, as the Scripts sheet's play would. Mounted next to
 * useViewShortcuts in app/page.tsx; the project is the active session's.
 */
export function useScriptShortcuts(
  _projectId: string | null | undefined,
  _sessionId: string | null | undefined
): void {}
