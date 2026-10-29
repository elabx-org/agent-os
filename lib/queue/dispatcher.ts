/**
 * Sends queued messages when their session is ready (flag `queue`): one
 * item per idle edge from lib/session-watch.ts, plus a 2s re-check of
 * sessions with pending items. Started by lib/tickers.ts.
 */

import { getDb, queries, type Session } from "../db";
import { claudeHookAt } from "../claude-state";
import { flagOnFor, getFlag, getFlags, tickersDisabled } from "../flags";
import { applyPendingMode } from "../permission-apply";
import { readiness, type Readiness } from "../session-ready";
import { onEdge, type WatchEdge } from "../session-watch";
import { sendText } from "../tmux-send";
import { beforeAgentSend } from "../turns";
import { limitStore } from "../limits/store";
import { markResumed } from "../limits/watch";
import { wentOnSince } from "../limits/went-on";
import { clearMoving, markMoving } from "../worktree-moving";
import { queueStore, type NewQueueItem, type QueueStore } from "./store";
import {
  takesNotice,
  type EnqueueRequest,
  type EnqueueResult,
  type QueueItem,
  type QueueOrigin,
} from "./types";

const RECHECK_MS = 2000;
/** Between the two reads that must agree before a queued send */
const CONFIRM_MS = 1000;
/** The same for a send now: shorter, the user is waiting on it */
const SEND_NOW_CONFIRM_MS = 300;
/** After a send, the next waits until the agent was seen busy, or this */
const BUSY_WAIT_MS = 20_000;

/** Agents with no prompt hook: their turn's pre snapshot is taken here */
const SNAPSHOT_BEFORE_SEND = new Set(["codex", "gemini"]);

export interface DispatcherDeps {
  store: QueueStore;
  getSession(id: string): Session | null;
  readiness(session: Session): Promise<Readiness>;
  send(session: Session, text: string): Promise<void>;
  /** Flag `queue` for this session */
  queueOn(sessionId: string): boolean;
  /**
   * Flag `autoResume`: M6's resume items go only while it is on, with or
   * without the queue. Absent: they never go
   */
  resumeOn?(): boolean;
  beforeAgentSend(session: Session, text: string): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /**
   * When the agent's hooks last reported (ms), if it has hooks: an event
   * after the send means it took the message, even when the turn was over
   * before a read saw it busy
   */
  hookAt?(session: Session): number | null;
  /**
   * A scheduled resume (M6) whose session went on without it: drops it
   * (and the limit) and says true, so nothing is typed
   */
  dropStaleResume?(session: Session, item: QueueItem): boolean;
  /** A resume was typed in: the limit is over (M6) */
  resumed?(session: Session): void;
  /**
   * A scheduled resume at the head while autoResume is off: it would never
   * go and would hold everything behind it, so it is dropped (with its
   * at_reset choice) and the next item gets its turn (M6)
   */
  dropParkedResume?(session: Session, item: QueueItem): void;
  /**
   * Applies the session's pending permission mode (flag modeAtIdle), so
   * the next turn runs in it. Called under the session's lock before a
   * queued send; its failure never holds the send back
   */
  applyPendingMode?(session: Session): Promise<unknown>;
  /**
   * Runs a claimed `kind='move'` item (M5, lib/worktree-move.ts
   * runScheduledMove) instead of typing it in; goes with or without the
   * queue flag. Throws when the move failed. Absent: move items wait
   */
  runMove?(session: Session, item: QueueItem): Promise<void>;
}

export interface DispatcherState {
  /** Per-session chains: one send decision at a time per session */
  locks: Map<string, Promise<unknown>>;
  /** Session -> until when the next send waits for the agent to start */
  awaitBusy: Map<string, number>;
  /** Session -> when its last send started */
  sentAt: Map<string, number>;
}

export function newDispatcherState(): DispatcherState {
  return { locks: new Map(), awaitBusy: new Map(), sentAt: new Map() };
}

/** The text that goes in: the undo notice first, attachments after */
export function composeText(notice: string | null, item: QueueItem): string {
  return [notice, item.text, ...item.attachments]
    .filter((part) => part && part.trim())
    .join(" ");
}

export function createDispatcher(
  deps: DispatcherDeps,
  state: DispatcherState = newDispatcherState()
) {
  const { store } = deps;

  function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const before = state.locks.get(sessionId) ?? Promise.resolve();
    const run = before.then(fn, fn);
    const tail = run.catch(() => {});
    state.locks.set(sessionId, tail);
    tail.then(() => {
      if (state.locks.get(sessionId) === tail) state.locks.delete(sessionId);
    });
    return run;
  }

  async function read(session: Session): Promise<Readiness> {
    const r = await deps.readiness(session);
    // It took the last message: the next one may go when it is done
    if (r.holdReason === "busy") state.awaitBusy.delete(session.id);
    return r;
  }

  /** Still waiting for the agent to pick up the last message */
  function awaiting(sessionId: string): boolean {
    const until = state.awaitBusy.get(sessionId);
    if (until === undefined) return false;
    const session = deps.hookAt ? deps.getSession(sessionId) : null;
    const hookAt = session ? deps.hookAt!(session) : null;
    const sent = state.sentAt.get(sessionId) ?? Infinity;
    if (deps.now() < until && !(hookAt !== null && hookAt >= sent)) return true;
    state.awaitBusy.delete(sessionId);
    return false;
  }

  /**
   * Types a claimed (sending) item in, after one more read right before
   * the paste. False when it went back to pending; throws when it failed
   */
  async function deliver(session: Session, item: QueueItem): Promise<boolean> {
    // A slash command must stay as it is: the notice waits for a message
    const notice =
      item.kind === "command" || !takesNotice(item.text)
        ? null
        : store.takeUndoNotice(session.id);
    const restoreNotice = () => {
      if (notice) store.setUndoNotice(session.id, notice);
    };
    const text = composeText(notice, item);
    if (session.permission_pending && deps.applyPendingMode) {
      await deps.applyPendingMode(session).catch((error) => {
        console.error("[queue] pending mode before send:", error);
      });
    }
    try {
      if (SNAPSHOT_BEFORE_SEND.has(session.agent_type)) {
        await deps.beforeAgentSend(session, text).catch((error) => {
          console.error("[queue] snapshot before send:", error);
        });
      }
      if (!(await read(session)).ready) {
        store.release(session.id, item.id);
        restoreNotice();
        return false;
      }
      state.sentAt.set(session.id, deps.now());
      await deps.send(session, text);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      store.markFailed(session.id, item.id, why);
      restoreNotice();
      throw error;
    }
    store.markSent(session.id, item.id);
    state.awaitBusy.set(session.id, deps.now() + BUSY_WAIT_MS);
    return true;
  }

  /** Two reads in a row, `gapMs` apart, that both say ready */
  async function readyTwice(session: Session, gapMs: number) {
    if (!(await read(session)).ready) return false;
    await deps.sleep(gapMs);
    return (await read(session)).ready;
  }

  /**
   * One look at a session: sends its next item when it is ready. Skipped
   * while another look holds the lock. A pending permission mode goes in
   * through deliver's applyPendingMode (flag modeAtIdle), or waits for the
   * user's own restart: the session is never restarted from here
   */
  async function service(sessionId: string): Promise<void> {
    if (state.locks.has(sessionId)) return;
    // A claimed move runs after the lock is let go: it holds the session
    // itself (readiness "moving"), so a send now isn't kept waiting on it
    const started: { move?: Promise<void> } = {};
    await withLock(sessionId, async () => {
      const session = deps.getSession(sessionId);
      if (!session) return;
      let head = store.head(sessionId);
      if (!head) return;
      // autoResume gates the scheduled resume, not the user's Resume now
      if (
        head.kind === "resume" &&
        head.origin === "system" &&
        !deps.resumeOn?.()
      ) {
        if (deps.dropParkedResume) deps.dropParkedResume(session, head);
        else store.cancelItem(sessionId, head.id);
        head = store.head(sessionId);
        if (!head) return;
      }
      // A move without its runner waits (tests, or a copy without it)
      if (head.kind === "move" && !deps.runMove) return;
      // A resume left here may go (the user's, or autoResume is on); a
      // scheduled move goes with or without the queue
      const on =
        head.kind === "resume" ||
        head.kind === "move" ||
        deps.queueOn(sessionId);
      if (!on) return;
      // A move's notBefore only holds builds without M5 (store MOVE_HOLD)
      if (
        head.kind !== "move" &&
        head.notBefore !== null &&
        head.notBefore > deps.now()
      )
        return;
      if (
        head.kind === "resume" &&
        head.origin === "system" &&
        deps.dropStaleResume?.(session, head)
      )
        return;
      if (awaiting(sessionId)) {
        await read(session);
        return;
      }
      if (!(await readyTwice(session, CONFIRM_MS))) return;

      const item = store.claimNext(sessionId, deps.now());
      if (!item) return;
      if (item.kind === "move") {
        started.move = runMove(session, item);
        return;
      }
      const sent = await deliver(session, item);
      if (sent && item.kind === "resume") deps.resumed?.(session);
    });
    // Not awaited: a move may take a minute or more, and the 2s re-check
    // waits for every service() call. The move holds its session itself
    void started.move;
  }

  /**
   * A claimed move (M5): never typed in, no undo notice, snapshot or
   * pending mode. runMove holds the session from its first (synchronous)
   * step, so it is started under the lock. Sent when moved, failed (with
   * why) when it was rolled back
   */
  function runMove(session: Session, item: QueueItem): Promise<void> {
    let running: Promise<void>;
    try {
      running = deps.runMove!(session, item);
    } catch (error) {
      running = Promise.reject(error);
    }
    return running
      .then(
        () => {
          store.markSent(session.id, item.id);
        },
        (error) => {
          const why = error instanceof Error ? error.message : String(error);
          store.markFailed(session.id, item.id, why);
          console.error("[queue] move:", why);
        }
      )
      .catch((error) => console.error("[queue] move:", error));
  }

  /**
   * The POST /queue rule: with `sendNow`, sends at once only when the
   * session is ready and nothing is pending ahead of it (under the
   * dispatcher's lock), otherwise queues
   */
  async function sendOrQueue(
    session: Session,
    request: EnqueueRequest,
    origin: QueueOrigin
  ): Promise<EnqueueResult> {
    const item: NewQueueItem = {
      text: request.text,
      attachments: request.attachments,
      kind: request.kind ?? "message",
      origin,
    };
    const queue = (): EnqueueResult => ({
      item: store.enqueue(session.id, item),
      sent: false,
    });
    if (!request.sendNow) return queue();
    return withLock(session.id, async () => {
      if (store.hasActive(session.id) || awaiting(session.id)) return queue();
      if (!(await readyTwice(session, SEND_NOW_CONFIRM_MS))) return queue();
      const claimed = store.claimDirect(session.id, item);
      if (!claimed) return queue();
      const sent = await deliver(session, claimed);
      return { item: store.getItem(session.id, claimed.id) ?? claimed, sent };
    });
  }

  /**
   * The pending permission mode at an idle edge, after any send or look
   * already holding the session's lock (lib/permission-apply)
   */
  async function applyPending(sessionId: string): Promise<unknown> {
    if (!deps.applyPendingMode) return null;
    return withLock(sessionId, async () => {
      const session = deps.getSession(sessionId);
      if (!session?.permission_pending) return null;
      return deps.applyPendingMode!(session);
    });
  }

  function handleEdge(edge: WatchEdge): void {
    if (edge.to === "running") {
      state.awaitBusy.delete(edge.sessionId);
      return;
    }
    if (edge.to !== "idle" && edge.to !== "waiting") return;
    service(edge.sessionId).catch((error) =>
      console.error("[queue] dispatch:", error)
    );
  }

  /** Every session with something to send */
  async function recheck(): Promise<void> {
    await Promise.all(
      store
        .sessionsWithPending()
        .map((id) =>
          service(id).catch((error) =>
            console.error("[queue] dispatch:", error)
          )
        )
    );
  }

  return {
    service,
    sendOrQueue,
    handleEdge,
    recheck,
    applyPending,
    withLock,
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;

// On globalThis: the dispatcher runs in server.ts's copy of this module and
// POST /queue in Next's, and both must share one lock per session
const shared = globalThis as unknown as {
  __agentosDispatch?: { state: DispatcherState; started: boolean };
};

function dispatcher(): Dispatcher {
  shared.__agentosDispatch ??= {
    state: newDispatcherState(),
    started: false,
  };
  const db = getDb();
  return createDispatcher(
    {
      store: queueStore(db),
      getSession: (id) =>
        (queries.getSession(db).get(id) as Session | undefined) ?? null,
      readiness,
      send: (session, text) => sendText(session, text, { pressEnter: true }),
      queueOn: (id) => flagOnFor("queue", id),
      resumeOn: () => getFlags().autoResume,
      beforeAgentSend,
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      hookAt: (session) =>
        session.agent_type === "claude" ? claudeHookAt(session.id) : null,
      dropStaleResume: (session, item) => {
        if (session.limited_at === null) return false;
        if (!wentOnSince(session.id, session.limited_at)) return false;
        queueStore().cancelItem(session.id, item.id);
        limitStore().clearLimited(session.id);
        return true;
      },
      dropParkedResume: (session, item) => {
        queueStore().cancelItem(session.id, item.id);
        if (session.resume_policy === "at_reset")
          limitStore().setPolicy(session.id, null, null);
      },
      resumed: (session) => {
        markResumed(session.id).catch((error) =>
          console.error("[queue] resumed:", error)
        );
      },
      applyPendingMode: async (session) =>
        getFlag("modeAtIdle") ? applyPendingMode(session) : null,
      runMove: (session, item) => {
        // Held before anything yields (see runMove above); the move clears it
        markMoving(session.id);
        return loadMove().then(
          (m) => m.runScheduledMove(session, item),
          (error) => {
            clearMoving(session.id);
            throw error;
          }
        );
      },
    },
    shared.__agentosDispatch.state
  );
}

// Loaded when first needed: lib/worktree-move.ts imports this module
type MoveModule = typeof import("../worktree-move");
let moveModule: MoveModule | null = null;
async function loadMove(): Promise<MoveModule> {
  return (moveModule ??= await import("../worktree-move"));
}

let instance: Dispatcher | null = null;
const live = () => (instance ??= dispatcher());

export function startDispatcher(): void {
  if (tickersDisabled()) return;
  live();
  if (shared.__agentosDispatch!.started) return;
  shared.__agentosDispatch!.started = true;

  const failed = queueStore().failInterrupted();
  if (failed) console.log(`[queue] ${failed} item(s) cut off by a restart`);
  // A move cut off mid-way: failed, and its source checked (M5)
  const moves = queueStore().failInterruptedMoves();
  if (moves.length) {
    console.log(`[queue] ${moves.length} move(s) cut off by a restart`);
    loadMove()
      .then((m) => Promise.all(moves.map((item) => m.recoverMove(item))))
      .catch((error) => console.error("[queue] recovering a move:", error));
  }
  onEdge((edge) => live().handleEdge(edge));
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await live().recheck();
    } catch (error) {
      console.error("[queue] re-check:", error);
    } finally {
      busy = false;
    }
  }, RECHECK_MS).unref();
}

/** One look at a session now (Resume now): sends its head when ready */
export function serviceNow(sessionId: string): Promise<void> {
  return live().service(sessionId);
}

/**
 * The POST /queue rule: with `sendNow`, sends at once only when the session
 * is ready and nothing is pending ahead of it (under the dispatcher's lock),
 * otherwise queues. Any undo notice is prefixed to what is sent
 */
export async function sendOrQueue(
  session: Session,
  request: EnqueueRequest,
  origin: QueueOrigin
): Promise<EnqueueResult> {
  return live().sendOrQueue(session, request, origin);
}

/**
 * Applies a session's pending permission mode under its dispatcher lock, so
 * the keys never interleave with a queued paste (lib/permission-apply)
 */
export async function applyPendingAtIdle(sessionId: string): Promise<unknown> {
  return live().applyPending(sessionId);
}

/**
 * Runs `fn` under the session's dispatcher lock, after any send or look
 * holding it: POST /permission-mode's Shift+Tab presses never interleave
 * with a queued paste or the idle applier's own presses
 */
export async function withSessionLock<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  return live().withLock(sessionId, fn);
}
