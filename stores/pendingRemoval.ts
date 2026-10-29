import { useSyncExternalStore } from "react";
import { proxy, snapshot, subscribe } from "valtio";

/**
 * What was just deleted but can still be undone: hidden from the lists
 * until the delete goes through (lib/undo.ts), even when they refetch.
 * `settles`: sessions swiped to Settled (id → ms swiped), shown settled
 * until the settle goes through or is undone (settleWithUndo).
 */
export const pendingRemoval = proxy<{
  sessions: Record<string, true>;
  projects: Record<string, true>;
  groups: Record<string, true>;
  settles: Record<string, number>;
}>({ sessions: {}, projects: {}, groups: {}, settles: {} });

/** What removeWithUndo hides; a settle keeps its row (settleWithUndo) */
export type RemovalKind = "sessions" | "projects" | "groups";

/** The current removals, re-rendering on any change (no property tracking) */
export function usePendingRemoval() {
  return useSyncExternalStore(
    (onChange) => subscribe(pendingRemoval, onChange),
    () => snapshot(pendingRemoval),
    () => snapshot(pendingRemoval)
  );
}
