/**
 * The words and gates the session views use for Settle (M8, N-Settle):
 * the ⋯ menu's Settle, its toast with Undo, and the bar where a settled
 * session's composer was. Pure, so the views and the tests share it.
 */

import type { Session } from "./db/types";
import { isEnded, type SettleError } from "./settle-types";

/** The ⋯ menu offers Settle: a session whose tmux still runs */
export function canSettle(
  session: Pick<Session, "settled_at" | "paused_at"> | null | undefined
): boolean {
  return !!session && !isEnded(session);
}

/** The route refused because it works or has queued messages: ask, then force */
export function isBusyRefusal(
  status: number,
  body: SettleError | null | undefined
): boolean {
  return status === 409 && body?.reason === "busy";
}

/** "Deck state line fix settled", "PR #106 merged" under it when it has one */
export function settledToast(
  title: string,
  session: Pick<Session, "pr_number" | "pr_status">
): { message: string; description?: string } {
  return {
    message: `${title} settled`,
    description:
      session.pr_number != null && session.pr_status === "merged"
        ? `PR #${session.pr_number} merged`
        : undefined,
  };
}

/** Claude picks its conversation up again; the others start fresh */
export function resumeLabel(agentType: string | null | undefined): string {
  return (agentType || "claude") === "claude" ? "Resume" : "Start fresh";
}

/** Unsettled, but the agent didn't start again */
export function notRelaunchedText(agent: string): string {
  return `${agent} didn't start again. Open the terminal to start it`;
}
