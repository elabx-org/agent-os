import { proxy } from "valtio";

/** A session opened empty by "Send and start a new session" */
export interface FreshSession {
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
  /** The session whose send menu is open: its pane dims behind the menu */
  menuFor: string | null;
}>({ fresh: {}, toast: null, menuFor: null });

export function markFresh(
  sessionId: string,
  from: { id: string; name: string }
) {
  bgSendStore.fresh[sessionId] = { sent: false };
  bgSendStore.toast = { sessionId, sentToId: from.id, sentToName: from.name };
}

/** Something was sent from this session's composer */
export function markFreshUsed(sessionId: string) {
  const fresh = bgSendStore.fresh[sessionId];
  if (fresh) fresh.sent = true;
  if (bgSendStore.toast?.sessionId === sessionId) bgSendStore.toast = null;
}

export function forgetFresh(sessionId: string) {
  delete bgSendStore.fresh[sessionId];
  if (bgSendStore.toast?.sessionId === sessionId) bgSendStore.toast = null;
}

export function dismissSentToast() {
  bgSendStore.toast = null;
}

/** The send menu of `sessionId` opened (true) or closed */
export function setSendMenuOpen(sessionId: string, open: boolean) {
  if (open) bgSendStore.menuFor = sessionId;
  else if (bgSendStore.menuFor === sessionId) bgSendStore.menuFor = null;
}
