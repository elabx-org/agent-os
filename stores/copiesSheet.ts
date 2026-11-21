import { proxy } from "valtio";

/**
 * The copies of a linked machine's sessions kept on this server (lib/backup):
 * which machine's list is up, and the copy being read. Settings and the
 * offline page open it; MachineCopiesSheetHost (Providers) draws it.
 */
export const copiesSheetStore = proxy<{
  machineId: string | null;
  /** The copy open in the viewer, null for the list */
  sessionId: string | null;
}>({
  machineId: null,
  sessionId: null,
});

export function openCopies(machineId: string, sessionId?: string): void {
  copiesSheetStore.machineId = machineId;
  copiesSheetStore.sessionId = sessionId ?? null;
}

export function openCopy(sessionId: string | null): void {
  copiesSheetStore.sessionId = sessionId;
}

export function closeCopies(): void {
  copiesSheetStore.machineId = null;
  copiesSheetStore.sessionId = null;
}
