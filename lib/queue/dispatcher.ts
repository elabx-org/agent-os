/**
 * Sends queued messages when their session is ready (flag `queue`): one
 * item per idle edge from lib/session-watch.ts, plus a 2s re-check of
 * sessions with pending items. Started by lib/tickers.ts.
 */

import type { Session } from "../db";
import type { EnqueueRequest, EnqueueResult, QueueOrigin } from "./types";

// M2 contract: signatures only; U2.1 implements them

export function startDispatcher(): void {}

/**
 * The POST /queue rule: with `sendNow`, sends at once only when the session
 * is ready and nothing is pending ahead of it (under the dispatcher's lock),
 * otherwise queues. Any undo notice is prefixed to what is sent
 */
export async function sendOrQueue(
  _session: Session,
  _request: EnqueueRequest,
  _origin: QueueOrigin
): Promise<EnqueueResult> {
  throw new Error("Not implemented");
}
