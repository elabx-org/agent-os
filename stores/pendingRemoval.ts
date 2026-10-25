import { useSyncExternalStore } from "react";
import { proxy, snapshot, subscribe } from "valtio";

/**
 * What was just deleted but can still be undone: hidden from the lists
 * until the delete goes through (lib/undo.ts), even when they refetch.
 */
export const pendingRemoval = proxy<{
  sessions: Record<string, true>;
  projects: Record<string, true>;
  groups: Record<string, true>;
}>({ sessions: {}, projects: {}, groups: {} });

export type RemovalKind = keyof typeof pendingRemoval;

/** The current removals, re-rendering on any change (no property tracking) */
export function usePendingRemoval() {
  return useSyncExternalStore(
    (onChange) => subscribe(pendingRemoval, onChange),
    () => snapshot(pendingRemoval),
    () => snapshot(pendingRemoval)
  );
}
