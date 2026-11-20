import { proxy } from "valtio";

/**
 * "Continue on another machine" (lib/session-move.ts): the session whose
 * sheet is up, drawn once by ContinueOnSheetHost. `from` is where the
 * running copy is when that isn't the tab's machine (bringing one back).
 */
export const continueSheetStore = proxy<{
  open: { sessionId: string; name: string; from?: string } | null;
  /** The focused pane's session when it can go elsewhere: the column's ⋯ */
  offer: { sessionId: string; name: string } | null;
}>({
  open: null,
  offer: null,
});

export function openContinueSheet(
  sessionId: string,
  name: string,
  from?: string
): void {
  continueSheetStore.open = { sessionId, name, from };
}

export function closeContinueSheet(): void {
  continueSheetStore.open = null;
}
