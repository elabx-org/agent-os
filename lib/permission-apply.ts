/**
 * Applying a session's pending permission mode at its next idle edge (flag
 * modeAtIdle): Claude through its Shift+Tab cycle (lib/permission-mode-live
 * applyModeLive), before the queue sends the next message. Never restarts
 * a session and never presses keys while it works or asks something.
 * M7 U1 builds it.
 */

import type { Session } from "./db";
import type { Mode } from "./permission-mode";

export interface ApplyPendingResult {
  /** The pending mode, if there was one */
  mode: Mode | null;
  applied: boolean;
  /** Why not: nothing pending, not Claude, busy or asking, cycle missed it */
  reason?: "none" | "not_claude" | "not_ready" | "not_in_cycle" | "failed";
}

/**
 * Applies `session.permission_pending` now if the session is idle and the
 * mode is in its Shift+Tab cycle; clears it when applied
 */
export async function applyPendingMode(
  session: Session
): Promise<ApplyPendingResult> {
  void session;
  return { mode: null, applied: false, reason: "none" };
}

/** Subscribes to lib/session-watch idle edges; started by lib/tickers.ts */
export function startModeApplier(): void {}
