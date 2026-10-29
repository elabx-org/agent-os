/**
 * Limited detection as a lib/session-watch.ts subscriber (no poll of its
 * own): at the end of a turn (running -> idle/waiting) it reads the screen
 * and Claude's status for a limit and marks the session (push `limited`); on
 * the next busy edge it clears it (push `resumed` when it had been resumed
 * at the reset). Started from lib/tickers.ts. U6.1 implements.
 */

import type { WatchEdge } from "../session-watch";

/** One edge, for the tests (deps injected by U6.1) */
export async function handleLimitEdge(_edge: WatchEdge): Promise<void> {
  // M6 U6.1
}

/** Subscribes to the session watch once; later calls do nothing */
export function startLimitWatch(): void {
  // M6 U6.1
}
