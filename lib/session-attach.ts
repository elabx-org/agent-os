/**
 * Resolves a message's attached sessions (M9) into the block typed in
 * front of it (formatAttachmentBlock in lib/session-attach-types.ts). Used
 * by the queue dispatcher when it types an item in (queued and sendNow
 * alike) and by send-keys (the queue flag off), so every path sends the
 * same block.
 */

import type { SessionAttachmentRef } from "./session-attach-types";

/**
 * The block for `refs` sent to `targetSessionId`: missing sessions, the
 * target itself and repeats are left out, at most MAX_SESSION_ATTACHMENTS.
 * Null when nothing is left. A summary that can't be built goes as a
 * one-line note instead of failing the send.
 */
export async function resolveAttachmentBlock(
  _targetSessionId: string,
  _refs: SessionAttachmentRef[]
): Promise<string | null> {
  if (!_refs.length) return null;
  throw new Error("Not implemented"); // M9 U1
}

/** POST bodies' `sessions`: a valid list, or what is wrong with it */
export function parseSessionRefs(
  value: unknown
): SessionAttachmentRef[] | string {
  if (value === undefined) return [];
  return "Not implemented"; // M9 U1
}
