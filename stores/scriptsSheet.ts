import { proxy, useSnapshot } from "valtio";

/**
 * M3: the Scripts sheet (N-Scripts) for a project, opened from a session's
 * ⋯, the project page or a script shortcut. `sessionId` is the session it
 * was opened over: its shell drawer runs terminal scripts.
 */
export const scriptsSheetStore = proxy<{
  projectId: string | null;
  sessionId: string | null;
}>({ projectId: null, sessionId: null });

export function openScripts(projectId: string, sessionId?: string | null) {
  scriptsSheetStore.projectId = projectId;
  scriptsSheetStore.sessionId = sessionId ?? null;
}

export function closeScripts() {
  scriptsSheetStore.projectId = null;
  scriptsSheetStore.sessionId = null;
}

export function useScriptsSheet() {
  return useSnapshot(scriptsSheetStore);
}
