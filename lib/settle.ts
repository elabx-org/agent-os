/**
 * Settle and unsettle a session (M8, N-Settle). Settling ends its tmux and
 * keeps the row, transcript, worktree, branch and snapshot refs; unsettling
 * clears settled_at and relaunches the agent (Claude with --resume). Server
 * only. Types in lib/settle-types.ts.
 */

import type { Session } from "./db";
import type { SettleError, SettleReason } from "./settle-types";

/** A refusal the routes turn into its status and SettleError body */
export class SettleRefused extends Error {
  constructor(
    readonly status: number,
    readonly body: SettleError
  ) {
    super(body.error);
  }
}

export interface SettleOptions {
  reason: SettleReason;
  /** Settle although it is working or has queued messages */
  force?: boolean;
}

/**
 * Settles the session: sets settled_at/settled_reason, ends its tmux,
 * pushes "settled" for automatic ones. Throws SettleRefused (busy without
 * force, already settled, paused). Returns the updated row
 */
export async function settleSession(
  _session: Session,
  _options: SettleOptions
): Promise<Session> {
  throw new Error("Not implemented"); // M8 U1
}

/**
 * Undo: clears settled_at (settled_reason = UNSETTLED_REASON) and
 * relaunches the agent. Throws SettleRefused when it isn't settled
 */
export async function unsettleSession(
  _session: Session
): Promise<{ session: Session; relaunched: boolean }> {
  throw new Error("Not implemented"); // M8 U1
}

/**
 * After a merge from Agent-OS: settles the session whose branch the PR
 * was (pr_number in that repo), whatever it is doing. Null when none
 */
export async function settlePrOwner(
  _repoDir: string,
  _prNumber: number
): Promise<Session | null> {
  return null; // M8 U1
}
