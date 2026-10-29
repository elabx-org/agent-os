/**
 * Whether a session can take a message now. Fails closed: any screen it
 * can't classify is not ready. Used by the dispatcher (twice in a row, and
 * again right before the paste) and GET /queue.
 */

import type { Session } from "./db";
import type { HoldReason } from "./queue/types";

// M2 contract: signature only; U2.1 implements it

export interface Readiness {
  ready: boolean;
  /** Null exactly when ready */
  holdReason: HoldReason | null;
}

export async function readiness(_session: Session): Promise<Readiness> {
  return { ready: false, holdReason: "unknown" };
}
