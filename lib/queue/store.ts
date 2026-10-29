/**
 * The session_queue table (migration 25): every status change happens in a
 * transaction, so two dispatchers on one DB never send an item twice.
 */

import type { SessionQueueRow } from "../db";
import type {
  EditQueueItemRequest,
  QueueItem,
  QueueKind,
  QueueOrigin,
} from "./types";

// M2 contract: signatures only; U2.1 implements them

export function toQueueItem(row: SessionQueueRow): QueueItem {
  let attachments: string[] = [];
  try {
    attachments = row.attachments ? JSON.parse(row.attachments) : [];
  } catch {
    // Unreadable: sent without
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    position: row.position,
    text: row.text,
    attachments,
    origin: row.origin as QueueOrigin,
    kind: row.kind as QueueKind,
    status: row.status as QueueItem["status"],
    notBefore: row.not_before,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    error: row.error,
  };
}

/** Pending and sending items by position, without the undo notice */
export function listQueue(_sessionId: string): QueueItem[] {
  return [];
}

export function getUndoNotice(_sessionId: string): QueueItem | null {
  return null;
}

/** Appends a pending item at the end */
export function enqueue(
  _sessionId: string,
  _item: {
    text: string;
    attachments?: string[];
    kind?: QueueKind;
    origin: QueueOrigin;
    notBefore?: number | null;
  }
): QueueItem {
  throw new Error("Not implemented");
}

/** Null when the item is gone or no longer pending */
export function editItem(
  _sessionId: string,
  _itemId: number,
  _patch: EditQueueItemRequest
): QueueItem | null {
  return null;
}

/** pending -> cancelled; false when it was not pending */
export function cancelItem(_sessionId: string, _itemId: number): boolean {
  return false;
}

/**
 * Stores the undo notice for the next outgoing message, replacing a pending
 * one (called by lib/turns.ts after an undo)
 */
export function setUndoNotice(_sessionId: string, _text: string): QueueItem {
  throw new Error("Not implemented");
}

/**
 * Takes the pending undo notice for a message about to be sent (marks it
 * sent in the same transaction): its text, or null
 */
export function takeUndoNotice(_sessionId: string): string | null {
  return null;
}

/** Sessions with pending items, for the dispatcher's re-check */
export function sessionsWithPending(): string[] {
  return [];
}

/** Drops a session's items (session delete) */
export function clearQueue(_sessionId: string): void {}
