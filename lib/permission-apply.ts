/**
 * Applying a session's pending permission mode at its next idle edge (flag
 * modeAtIdle): Claude through its Shift+Tab cycle (lib/permission-mode-live
 * applyModeLive), before the queue sends the next message. Never restarts
 * a session and never presses keys while it works or asks something.
 */

import { getDb, queries, type Session } from "./db";
import { getFlag, tickersDisabled } from "./flags";
import {
  normalizeMode,
  parseLaunchCaps,
  type Mode,
  type ModeAppliesAt,
} from "./permission-mode";
import { applyModeLive } from "./permission-mode-live";
import { applyPendingAtIdle } from "./queue/dispatcher";
import { readiness, type Readiness } from "./session-ready";
import { onEdge, type WatchEdge } from "./session-watch";

export interface ApplyPendingResult {
  /** The pending mode, if there was one */
  mode: Mode | null;
  applied: boolean;
  /** Why not: nothing pending, not Claude, busy or asking, cycle missed it */
  reason?: "none" | "not_claude" | "not_ready" | "not_in_cycle" | "failed";
}

/** Between the two readiness reads right before the presses */
const CONFIRM_MS = 300;

export interface ApplyPendingDeps {
  readiness(session: Session): Promise<Readiness>;
  applyModeLive(
    session: Session,
    mode: Mode
  ): Promise<{ applied: boolean; live: Mode | null }>;
  /** Clears permission_pending if it still is `mode`; keeps launch_caps */
  clearPending(sessionId: string, mode: Mode): void;
  sleep(ms: number): Promise<void>;
}

const liveDeps: ApplyPendingDeps = {
  readiness,
  applyModeLive,
  clearPending: (sessionId, mode) => {
    // Not clearSessionPermissionPending: that also drops launch_caps, which
    // still hold, as nothing was relaunched. Only the mode this applied, so
    // a newer pick made meanwhile stays
    getDb()
      .prepare(
        "UPDATE sessions SET permission_pending = NULL WHERE id = ? AND permission_pending = ?"
      )
      .run(sessionId, mode);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// On globalThis: the route (Next's copy) forgets what the applier (server.ts's
// copy) learned when the user picks again
const shared = globalThis as unknown as {
  __agentosModeApply?: { missed: Map<string, Mode>; started: boolean };
};

function applyState() {
  shared.__agentosModeApply ??= { missed: new Map(), started: false };
  return shared.__agentosModeApply;
}

/**
 * Forgets that a session's cycle missed its pending mode, so a new pick is
 * tried again. Called by POST /permission-mode
 */
export function forgetModeMiss(sessionId: string): void {
  applyState().missed.delete(sessionId);
}

/**
 * Applies `session.permission_pending` now if the session is idle and the
 * mode is in its Shift+Tab cycle; clears it when applied. A mode the cycle
 * doesn't have (full access without the Labs cap, or one this Claude
 * version lacks) stays pending for the user's restart and isn't tried again
 * until they pick anew. The caller serialises it with the queue's sends
 */
export async function applyPendingMode(
  session: Session,
  deps: ApplyPendingDeps = liveDeps
): Promise<ApplyPendingResult> {
  const mode = normalizeMode(session.permission_pending);
  if (!mode) return { mode: null, applied: false, reason: "none" };
  if (session.agent_type !== "claude") {
    return { mode, applied: false, reason: "not_claude" };
  }
  const { missed } = applyState();
  if (
    (mode === "bypassPermissions" &&
      !parseLaunchCaps(session.launch_caps).allowBypassCycle) ||
    missed.get(session.id) === mode
  ) {
    return { mode, applied: false, reason: "not_in_cycle" };
  }

  // Two reads in a row, right before the presses: a key never lands while
  // it works or in a dialog. Any doubt is "not ready"
  try {
    if (!(await deps.readiness(session)).ready) {
      return { mode, applied: false, reason: "not_ready" };
    }
    await deps.sleep(CONFIRM_MS);
    if (!(await deps.readiness(session)).ready) {
      return { mode, applied: false, reason: "not_ready" };
    }
  } catch {
    return { mode, applied: false, reason: "not_ready" };
  }

  let outcome: { applied: boolean; live: Mode | null };
  try {
    outcome = await deps.applyModeLive(session, mode);
  } catch {
    return { mode, applied: false, reason: "failed" };
  }
  if (outcome.applied) {
    missed.delete(session.id);
    deps.clearPending(session.id, mode);
    return { mode, applied: true };
  }
  // No footer read: a dialog came up meanwhile, the next edge tries again
  if (outcome.live === null) return { mode, applied: false, reason: "failed" };
  missed.set(session.id, mode);
  return { mode, applied: false, reason: "not_in_cycle" };
}

export interface ApplyDecisionInput {
  agentType: string;
  running: boolean;
  /** lib/session-ready readiness; only read for running Claude with the flag on */
  ready: boolean;
  mode: Mode;
  /** Flag modeAtIdle */
  flagOn: boolean;
  /** launch_caps.allowBypassCycle: full access is in the Shift+Tab cycle */
  canCycleBypass: boolean;
}

export interface ApplyDecision {
  /**
   * live: press through the cycle now (a miss falls back to pending +
   * restart); pending: store permission_pending, no keys; store: only the
   * stored mode changes
   */
  action: "live" | "pending" | "store";
  appliesAt: ModeAppliesAt;
}

/** What POST /permission-mode does with a user's pick */
export function decideApply(input: ApplyDecisionInput): ApplyDecision {
  if (!input.running) return { action: "store", appliesAt: "nextLaunch" };
  // Codex and Gemini take it when they're next started
  if (input.agentType !== "claude") {
    return { action: "store", appliesAt: "restart" };
  }
  // Without the Labs cap only a relaunch gives full access: the user's call
  if (input.mode === "bypassPermissions" && !input.canCycleBypass) {
    return { action: "pending", appliesAt: "restart" };
  }
  // Mid-turn: wait for the idle edge instead of pressing keys now
  if (input.flagOn && !input.ready) {
    return { action: "pending", appliesAt: "nextTurn" };
  }
  return { action: "live", appliesAt: "now" };
}

export interface ModeApplierDeps {
  flagOn(): boolean;
  getSession(id: string): Session | null;
  /** applyPendingMode under the dispatcher's per-session lock */
  apply(sessionId: string): Promise<unknown>;
}

/** The session-watch subscriber: a turn's end tries the pending mode */
export function modeEdgeHandler(
  deps: ModeApplierDeps
): (edge: WatchEdge) => void {
  return (edge) => {
    if (edge.to !== "idle" && edge.to !== "waiting") return;
    if (!deps.flagOn()) return;
    let session: Session | null = null;
    try {
      session = deps.getSession(edge.sessionId);
    } catch (error) {
      console.error("[mode] session lookup:", error);
    }
    if (!session?.permission_pending || session.agent_type !== "claude") {
      return;
    }
    deps
      .apply(session.id)
      .catch((error) => console.error("[mode] apply at idle:", error));
  };
}

/** Subscribes to lib/session-watch idle edges; started by lib/tickers.ts */
export function startModeApplier(): void {
  const state = applyState();
  if (state.started || tickersDisabled()) return;
  state.started = true;
  onEdge(
    modeEdgeHandler({
      flagOn: () => getFlag("modeAtIdle"),
      getSession: (id) =>
        (queries.getSession(getDb()).get(id) as Session | undefined) ?? null,
      apply: applyPendingAtIdle,
    })
  );
}
