/**
 * Auto-settle (M8, flag autoSettle): a session whose PR merged settles only
 * when it is safe (idle, nothing queued, no user message or terminal input
 * in AUTO_SETTLE_QUIET_MS, not focused on any client, not undone before);
 * otherwise it keeps the "PR #N merged · Settle" chip and is weighed again
 * on the next poll.
 */

import type { Session } from "./db";
import type { AutoSettleBlock, AutoSettleInput } from "./settle-types";

/** Null when it may settle now, else what stops it. Pure */
export function autoSettleBlock(
  _input: AutoSettleInput
): AutoSettleBlock | null {
  return "flag_off"; // M8 U2
}

/** ms of the session's last user message or terminal input; null when unknown */
export async function lastInputAt(_session: Session): Promise<number | null> {
  return null; // M8 U2
}

/** Weighs every merged, unsettled session and settles the safe ones */
export async function autoSettlePass(): Promise<number> {
  return 0; // M8 U2
}
