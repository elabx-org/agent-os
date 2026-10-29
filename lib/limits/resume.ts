/**
 * Resuming a limited session (POST/DELETE /api/sessions/[id]/resume).
 * reset: policy at_reset, and a queue item kind "resume" (lib/queue) with
 * not_before = limited_until + RESUME_GRACE_MS, at least RESUME_STAGGER_MS
 * from every other pending resume. now: clears the limit and queues the
 * resume due at once. snooze: policy snooze, nothing queued. The queue item
 * survives a server restart, so a resume goes once. The dispatcher sends a
 * resume only while flag `autoResume` is on, and only when the session is
 * ready (a permission or question on screen holds it).
 */

import type Database from "better-sqlite3";
import { getDb, queries, type Session, type SessionQueueRow } from "../db";
import { cachedClaudeUsage, type UsageResponse } from "../claude-usage";
import { getFlags, tickersDisabled } from "../flags";
import { serviceNow } from "../queue/dispatcher";
import { queueStore, toQueueItem } from "../queue/store";
import type { QueueItem } from "../queue/types";
import { limitStore } from "./store";
import {
  DEFAULT_RESUME_TEXT,
  RESUME_GRACE_MS,
  RESUME_STAGGER_MS,
  limitStateOf,
  type LimitKind,
  type ResumeRequest,
  type ResumeResult,
} from "./types";

const TICK_MS = 15_000;

/** scheduleResume on a session whose limit has reset or never was */
export class NotLimitedError extends Error {
  constructor() {
    super("Session is not limited");
    this.name = "NotLimitedError";
  }
}

/**
 * When the next resume may go: `until + RESUME_GRACE_MS`, pushed back to
 * RESUME_STAGGER_MS after any of `taken` (other pending resumes'
 * not_before) it would come too close to. Pure
 */
export function staggeredResumeAt(
  until: number,
  taken: readonly number[]
): number {
  let at = until + RESUME_GRACE_MS;
  for (;;) {
    const close = taken.filter((t) => Math.abs(at - t) < RESUME_STAGGER_MS);
    if (!close.length) return at;
    at = Math.max(...close) + RESUME_STAGGER_MS;
  }
}

/** The usage API's reset for a kind of limit (ms), when it says */
export function usageResetFor(
  usage: UsageResponse | null,
  kind: LimitKind | null
): number | null {
  if (!usage) return null;
  const block =
    kind === "session"
      ? usage.five_hour
      : kind === "week"
        ? usage.seven_day
        : kind === "opus"
          ? usage.seven_day_opus
          : kind === "sonnet"
            ? usage.seven_day_sonnet
            : null;
  const at = block?.resets_at ? Date.parse(block.resets_at) : NaN;
  return Number.isFinite(at) ? at : null;
}

export interface ResumeDeps {
  db: Database.Database;
  /** Has the dispatcher look at the session now (Resume now) */
  kick(sessionId: string): void;
  /** The usage API's last figures, for a reset no other source gave */
  usage(): UsageResponse | null;
}

/** The scheduler on one connection (tests open their own) */
export function createResume(deps: ResumeDeps) {
  const { db } = deps;
  const queue = queueStore(db);
  const limits = limitStore(db);
  const s = {
    pending: db.prepare(
      `SELECT * FROM session_queue WHERE session_id = ? AND kind = 'resume'
         AND status = 'pending'
       ORDER BY id`
    ),
    taken: db.prepare(
      `SELECT not_before FROM session_queue WHERE kind = 'resume'
         AND status = 'pending' AND session_id != ? AND not_before IS NOT NULL`
    ),
    // A resume queued for this limit, whatever became of it: it goes once
    since: db.prepare(
      `SELECT 1 FROM session_queue WHERE session_id = ? AND kind = 'resume'
         AND status IN ('pending', 'sending', 'sent', 'failed')
         AND created_at >= ?
       LIMIT 1`
    ),
  };

  const reread = (id: string): Session | null =>
    (queries.getSession(db).get(id) as Session | undefined) ?? null;

  const result = (
    id: string,
    item: QueueItem | null,
    now: number
  ): ResumeResult => ({
    state: limitStateOf(reread(id) ?? {}, now),
    item,
  });

  function pendingResume(sessionId: string): QueueItem | null {
    const r = s.pending.get(sessionId) as SessionQueueRow | undefined;
    return r ? toQueueItem(r) : null;
  }

  /** Cancels every pending resume of the session */
  function dropPending(sessionId: string): void {
    for (const r of s.pending.all(sessionId) as SessionQueueRow[]) {
      queue.cancelItem(sessionId, r.id);
    }
  }

  /** Queues the session's resume for its reset, replacing a pending one */
  function queueAtReset(
    sessionId: string,
    until: number,
    text: string
  ): QueueItem {
    return db.transaction(() => {
      dropPending(sessionId);
      const taken = (s.taken.all(sessionId) as { not_before: number }[]).map(
        (r) => r.not_before
      );
      return queue.enqueue(sessionId, {
        text,
        kind: "resume",
        origin: "system",
        notBefore: staggeredResumeAt(until, taken),
      });
    })();
  }

  /**
   * Applies a ResumeRequest; throws NotLimitedError on a session that isn't
   * limited (Resume now also goes for one with a policy set)
   */
  async function scheduleResume(
    session: Session,
    request: ResumeRequest,
    now: number = Date.now()
  ): Promise<ResumeResult> {
    const state = limitStateOf(session, now);
    const allowed =
      state.limited || (request.when === "now" && state.policy !== null);
    if (!allowed) throw new NotLimitedError();
    const text = request.text?.trim() ? request.text : DEFAULT_RESUME_TEXT;

    switch (request.when) {
      case "reset": {
        limits.setPolicy(session.id, "at_reset", text);
        // Unknown reset: resumeTick queues it once a source says
        const item =
          state.limitedUntil === null
            ? (dropPending(session.id), null)
            : queueAtReset(session.id, state.limitedUntil, text);
        return result(session.id, item, now);
      }
      case "now": {
        const item = db.transaction(() => {
          limits.clearLimited(session.id);
          dropPending(session.id);
          // The user's own click: goes even with autoResume off
          return queue.enqueue(session.id, {
            text,
            kind: "resume",
            origin: "user",
            notBefore: null,
          });
        })();
        deps.kick(session.id);
        return result(session.id, item, now);
      }
      case "snooze": {
        db.transaction(() => {
          limits.setPolicy(session.id, "snooze", null);
          dropPending(session.id);
        })();
        return result(session.id, null, now);
      }
    }
  }

  /** Cancels a scheduled resume or a snooze: back to the card */
  function cancelResume(session: Session, now: number = Date.now()) {
    db.transaction(() => {
      dropPending(session.id);
      limits.setPolicy(session.id, null, null);
    })();
    return result(session.id, null, now);
  }

  /**
   * One pass: queues the at_reset sessions whose reset became known after
   * they were scheduled (from the usage API when nothing else said), and
   * ends a snooze whose reset has passed. Nothing is typed here
   */
  function resumeTick(now: number = Date.now()): void {
    for (const row of limits.listLimited()) {
      const state = limitStateOf(row, now);
      let until = state.limitedUntil;
      if (state.policy === "snooze") {
        if (until !== null && now >= until) limits.clearLimited(row.id);
        continue;
      }
      if (state.policy !== "at_reset") continue;
      if (until === null) {
        const usage = usageResetFor(deps.usage(), state.kind);
        if (usage === null || usage <= (state.limitedAt ?? 0)) continue;
        limits.setUntil(row.id, usage);
        until = usage;
      }
      if (s.since.get(row.id, state.limitedAt ?? 0)) continue;
      queueAtReset(row.id, until, state.resumeText || DEFAULT_RESUME_TEXT);
    }
  }

  return {
    scheduleResume,
    cancelResume,
    pendingResume,
    resumeTick,
  };
}

export type Resume = ReturnType<typeof createResume>;

const live = () =>
  createResume({
    db: getDb(),
    kick: (id) => {
      serviceNow(id).catch((error) =>
        console.error("[resume] dispatch:", error)
      );
    },
    usage: () => {
      try {
        return cachedClaudeUsage();
      } catch {
        return null;
      }
    },
  });

/**
 * Applies a ResumeRequest; throws NotLimitedError on a session that isn't
 * limited
 */
export async function scheduleResume(
  session: Session,
  request: ResumeRequest,
  now?: number
): Promise<ResumeResult> {
  return live().scheduleResume(session, request, now);
}

/** Cancels a scheduled resume or a snooze: back to the card */
export function cancelResume(session: Session): ResumeResult {
  return live().cancelResume(session);
}

/** The session's pending resume item, if any */
export function pendingResume(sessionId: string): QueueItem | null {
  return live().pendingResume(sessionId);
}

/**
 * One pass: queues the at_reset sessions whose reset became known after
 * they were scheduled. Injected `now` for the clock-mocked tests
 */
export function resumeTick(now: number = Date.now()): void {
  live().resumeTick(now);
}

const shared = globalThis as unknown as { __agentosResumeTicker?: boolean };

/** Starts the resume pass once (flag autoResume); later calls do nothing */
export function startResumeTicker(): void {
  if (tickersDisabled() || shared.__agentosResumeTicker) return;
  shared.__agentosResumeTicker = true;
  setInterval(() => {
    try {
      if (getFlags().autoResume) resumeTick();
    } catch (error) {
      console.error("[resume] tick:", error);
    }
  }, TICK_MS).unref();
}
