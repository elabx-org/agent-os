/**
 * The session_queue table (migration 25): every status change happens in a
 * transaction, so two dispatchers on one DB never send an item twice.
 */

import type Database from "better-sqlite3";
import { getDb, type SessionQueueRow } from "../db";
import type {
  EditQueueItemRequest,
  QueueItem,
  QueueKind,
  QueueOrigin,
} from "./types";

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

export interface NewQueueItem {
  text: string;
  attachments?: string[];
  kind?: QueueKind;
  origin: QueueOrigin;
  notBefore?: number | null;
}

/** The queue's statements on one connection (tests open a second one) */
export function createQueueStore(db: Database.Database) {
  // Pending and sending items, not the notice: what the positions number
  const active = `session_id = ? AND status IN ('pending', 'sending') AND kind != 'undo_notice'`;
  const s = {
    get: db.prepare(
      `SELECT * FROM session_queue WHERE id = ? AND session_id = ?`
    ),
    list: db.prepare(
      `SELECT * FROM session_queue WHERE ${active}
       ORDER BY status = 'sending' DESC, position, id`
    ),
    pending: db.prepare(
      `SELECT * FROM session_queue WHERE session_id = ? AND status = 'pending'
         AND kind != 'undo_notice'
       ORDER BY position, id`
    ),
    countActive: db.prepare(
      `SELECT COUNT(*) AS n FROM session_queue WHERE ${active}`
    ),
    sending: db.prepare(
      `SELECT id FROM session_queue WHERE session_id = ? AND status = 'sending' LIMIT 1`
    ),
    insert: db.prepare(
      `INSERT INTO session_queue
         (session_id, position, text, attachments, origin, kind, status, not_before, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    setPosition: db.prepare(
      `UPDATE session_queue SET position = ? WHERE id = ?`
    ),
    setText: db.prepare(
      `UPDATE session_queue SET text = ? WHERE id = ? AND status = 'pending'`
    ),
    move: db.prepare(
      `UPDATE session_queue SET status = ?, sent_at = ?, error = ?
       WHERE id = ? AND session_id = ? AND status = ?`
    ),
    notice: db.prepare(
      `SELECT * FROM session_queue WHERE session_id = ? AND status = 'pending'
         AND kind = 'undo_notice'
       ORDER BY id DESC LIMIT 1`
    ),
    dropNotices: db.prepare(
      `UPDATE session_queue SET status = 'cancelled'
       WHERE session_id = ? AND status = 'pending' AND kind = 'undo_notice'`
    ),
    failed: db.prepare(
      `SELECT * FROM session_queue WHERE session_id = ? AND status = 'failed'
         AND kind != 'undo_notice' AND created_at >= ?
       ORDER BY id`
    ),
    withPending: db.prepare(
      `SELECT DISTINCT session_id FROM session_queue
       WHERE status = 'pending' AND kind != 'undo_notice'`
    ),
    clear: db.prepare(`DELETE FROM session_queue WHERE session_id = ?`),
  };

  const row = (sessionId: string, id: number) =>
    s.get.get(id, sessionId) as SessionQueueRow | undefined;

  /** Positions 1..n again: the item being sent first, then the rest in order */
  const renumber = (sessionId: string) => {
    const rows = s.list.all(sessionId) as SessionQueueRow[];
    rows.forEach((r, i) => {
      if (r.position !== i + 1) s.setPosition.run(i + 1, r.id);
    });
  };

  const insert = (
    sessionId: string,
    item: NewQueueItem,
    status: "pending" | "sending",
    position: number
  ): QueueItem => {
    const { lastInsertRowid } = s.insert.run(
      sessionId,
      position,
      item.text,
      item.attachments?.length ? JSON.stringify(item.attachments) : null,
      item.origin,
      item.kind ?? "message",
      status,
      item.notBefore ?? null,
      Date.now()
    );
    return toQueueItem(row(sessionId, Number(lastInsertRowid))!);
  };

  /** One status change, only from `from`; false when it wasn't there */
  const move = (
    sessionId: string,
    id: number,
    from: string,
    to: string,
    sentAt: number | null = null,
    error: string | null = null
  ) => s.move.run(to, sentAt, error, id, sessionId, from).changes === 1;

  const store = {
    /** Pending and sending items by position, without the undo notice */
    listQueue(sessionId: string): QueueItem[] {
      return (s.list.all(sessionId) as SessionQueueRow[]).map(toQueueItem);
    },

    /** Failed items created since `since` (ms) and not dismissed */
    listFailed(sessionId: string, since: number): QueueItem[] {
      return (s.failed.all(sessionId, since) as SessionQueueRow[]).map(
        toQueueItem
      );
    },

    /** failed -> cancelled: the user has seen it; false when not failed */
    dismissFailed(sessionId: string, itemId: number): boolean {
      return move(sessionId, itemId, "failed", "cancelled");
    },

    /** Any item of the session, whatever its status */
    getItem(sessionId: string, itemId: number): QueueItem | null {
      const r = row(sessionId, itemId);
      return r ? toQueueItem(r) : null;
    },

    getUndoNotice(sessionId: string): QueueItem | null {
      const r = s.notice.get(sessionId) as SessionQueueRow | undefined;
      return r ? toQueueItem(r) : null;
    },

    /** Appends a pending item at the end */
    enqueue(sessionId: string, item: NewQueueItem): QueueItem {
      if (item.kind === "undo_notice") {
        throw new TypeError("The undo notice goes through setUndoNotice");
      }
      return db.transaction(() => {
        const { n } = s.countActive.get(sessionId) as { n: number };
        return insert(sessionId, item, "pending", n + 1);
      })();
    },

    /** Null when the item is gone or no longer pending */
    editItem(
      sessionId: string,
      itemId: number,
      patch: EditQueueItemRequest
    ): QueueItem | null {
      return db.transaction(() => {
        const r = row(sessionId, itemId);
        if (!r || r.status !== "pending" || r.kind === "undo_notice")
          return null;
        if (typeof patch.text === "string") s.setText.run(patch.text, itemId);
        if (typeof patch.position === "number") {
          const pending = s.pending.all(sessionId) as SessionQueueRow[];
          const order = pending.filter((p) => p.id !== itemId);
          const at = Math.min(
            Math.max(Math.round(patch.position), 1),
            order.length + 1
          );
          order.splice(at - 1, 0, r);
          // Behind the item being sent, if any
          const offset = s.sending.get(sessionId) ? 1 : 0;
          order.forEach((p, i) => s.setPosition.run(offset + i + 1, p.id));
        }
        renumber(sessionId);
        return toQueueItem(row(sessionId, itemId)!);
      })();
    },

    /** pending -> cancelled; false when it was not pending */
    cancelItem(sessionId: string, itemId: number): boolean {
      return db.transaction(() => {
        if (!move(sessionId, itemId, "pending", "cancelled")) return false;
        renumber(sessionId);
        return true;
      })();
    },

    /**
     * Stores the undo notice for the next outgoing message, replacing a
     * pending one (called by lib/turns.ts after an undo)
     */
    setUndoNotice(sessionId: string, text: string): QueueItem {
      return db.transaction(() => {
        s.dropNotices.run(sessionId);
        return insert(
          sessionId,
          { text, kind: "undo_notice", origin: "system" },
          "pending",
          0
        );
      })();
    },

    /**
     * Takes the pending undo notice for a message about to be sent (marks it
     * sent in the same transaction): its text, or null
     */
    takeUndoNotice(sessionId: string): string | null {
      return db.transaction(() => {
        const r = s.notice.get(sessionId) as SessionQueueRow | undefined;
        if (!r || !move(sessionId, r.id, "pending", "sent", Date.now()))
          return null;
        return r.text;
      })();
    },

    /** Sessions with pending items, for the dispatcher's re-check */
    sessionsWithPending(): string[] {
      return (s.withPending.all() as { session_id: string }[]).map(
        (r) => r.session_id
      );
    },

    /** Drops a session's items (session delete) */
    clearQueue(sessionId: string): void {
      s.clear.run(sessionId);
    },

    /** Pending or sending items (not the notice) ahead of a new one */
    hasActive(sessionId: string): boolean {
      return (s.countActive.get(sessionId) as { n: number }).n > 0;
    },

    /** The next pending item, without claiming it */
    head(sessionId: string): QueueItem | null {
      const r = (s.pending.all(sessionId) as SessionQueueRow[])[0];
      return r ? toQueueItem(r) : null;
    },

    /**
     * Claims the first pending item (pending -> sending), unless one is
     * already being sent for the session or it waits for notBefore. The
     * transaction is the guard between processes
     */
    claimNext(sessionId: string, now = Date.now()): QueueItem | null {
      return db.transaction(() => {
        if (s.sending.get(sessionId)) return null;
        const r = (s.pending.all(sessionId) as SessionQueueRow[])[0];
        if (!r || (r.not_before !== null && r.not_before > now)) return null;
        if (!move(sessionId, r.id, "pending", "sending")) return null;
        renumber(sessionId);
        return toQueueItem(row(sessionId, r.id)!);
      })();
    },

    /**
     * A message to send at once, recorded as sending; null (nothing written)
     * when anything is pending or being sent ahead of it
     */
    claimDirect(sessionId: string, item: NewQueueItem): QueueItem | null {
      return db.transaction(() => {
        if (store.hasActive(sessionId)) return null;
        return insert(sessionId, item, "sending", 1);
      })();
    },

    /** sending -> sent */
    markSent(sessionId: string, itemId: number): boolean {
      return db.transaction(() => {
        const ok = move(sessionId, itemId, "sending", "sent", Date.now());
        renumber(sessionId);
        return ok;
      })();
    },

    /** sending -> failed, with why */
    markFailed(sessionId: string, itemId: number, error: string): boolean {
      return db.transaction(() => {
        const ok = move(sessionId, itemId, "sending", "failed", null, error);
        renumber(sessionId);
        return ok;
      })();
    },

    /** sending -> pending: claimed, then the session wasn't ready after all */
    release(sessionId: string, itemId: number): boolean {
      return db.transaction(() => {
        const ok = move(sessionId, itemId, "sending", "pending");
        renumber(sessionId);
        return ok;
      })();
    },

    /**
     * Items left sending by a process that died mid-send: failed, not
     * retried, since the text may have gone in. The composer shows them
     * with Retry, so the user decides
     */
    failInterrupted(): number {
      return db
        .prepare(
          `UPDATE session_queue SET status = 'failed',
             error = 'Cut off by a restart: it may have gone in'
           WHERE status = 'sending'`
        )
        .run().changes;
    },
  };
  return store;
}

export type QueueStore = ReturnType<typeof createQueueStore>;

const stores = new WeakMap<Database.Database, QueueStore>();

/** The store on the app's DB connection */
export function queueStore(db: Database.Database = getDb()): QueueStore {
  let store = stores.get(db);
  if (!store) {
    store = createQueueStore(db);
    stores.set(db, store);
  }
  return store;
}

/** Pending and sending items by position, without the undo notice */
export function listQueue(sessionId: string): QueueItem[] {
  return queueStore().listQueue(sessionId);
}

/** What didn't send in the last day and wasn't dismissed */
export function listFailed(sessionId: string): QueueItem[] {
  return queueStore().listFailed(sessionId, Date.now() - 24 * 60 * 60 * 1000);
}

export function getUndoNotice(sessionId: string): QueueItem | null {
  return queueStore().getUndoNotice(sessionId);
}

/** Appends a pending item at the end */
export function enqueue(sessionId: string, item: NewQueueItem): QueueItem {
  return queueStore().enqueue(sessionId, item);
}

/** Null when the item is gone or no longer pending */
export function editItem(
  sessionId: string,
  itemId: number,
  patch: EditQueueItemRequest
): QueueItem | null {
  return queueStore().editItem(sessionId, itemId, patch);
}

/** pending -> cancelled; false when it was not pending */
export function cancelItem(sessionId: string, itemId: number): boolean {
  return queueStore().cancelItem(sessionId, itemId);
}

/**
 * Stores the undo notice for the next outgoing message, replacing a pending
 * one (called by lib/turns.ts after an undo)
 */
export function setUndoNotice(sessionId: string, text: string): QueueItem {
  return queueStore().setUndoNotice(sessionId, text);
}

/**
 * Takes the pending undo notice for a message about to be sent (marks it
 * sent in the same transaction): its text, or null
 */
export function takeUndoNotice(sessionId: string): string | null {
  return queueStore().takeUndoNotice(sessionId);
}

/** Sessions with pending items, for the dispatcher's re-check */
export function sessionsWithPending(): string[] {
  return queueStore().sessionsWithPending();
}

/** Drops a session's items (session delete) */
export function clearQueue(sessionId: string): void {
  queueStore().clearQueue(sessionId);
}
