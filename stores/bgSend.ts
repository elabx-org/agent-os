import { proxy } from "valtio";

/** A session opened empty by "Send and start a new session" */
export interface FreshSession {
  /** The session the message went to */
  fromSessionId: string;
  fromName: string;
  createdAt: number;
  /** A message was sent from it: it is a real session now, never removed */
  sent: boolean;
}

/** "Sent to <name> · Keeps working · Open", shown over the fresh session */
export interface SentToast {
  /** The fresh session it shows over */
  sessionId: string;
  sentToId: string;
  sentToName: string;
}

/**
 * Background send (M10): the fresh sessions this page opened (removed when
 * left untouched) and the toast over the newest one.
 */
export const bgSendStore = proxy<{
  fresh: Record<string, FreshSession>;
  toast: SentToast | null;
}>({ fresh: {}, toast: null });

export function markFresh(
  sessionId: string,
  from: { id: string; name: string }
) {
  bgSendStore.fresh[sessionId] = {
    fromSessionId: from.id,
    fromName: from.name,
    createdAt: Date.now(),
    sent: false,
  };
  bgSendStore.toast = { sessionId, sentToId: from.id, sentToName: from.name };
}

/** Something was sent from this session's composer */
export function markFreshUsed(sessionId: string) {
  const fresh = bgSendStore.fresh[sessionId];
  if (fresh) fresh.sent = true;
  if (bgSendStore.toast?.sessionId === sessionId) bgSendStore.toast = null;
}

export function isFresh(sessionId: string): boolean {
  return sessionId in bgSendStore.fresh;
}

export function forgetFresh(sessionId: string) {
  delete bgSendStore.fresh[sessionId];
  if (bgSendStore.toast?.sessionId === sessionId) bgSendStore.toast = null;
}

export function dismissSentToast() {
  bgSendStore.toast = null;
}
