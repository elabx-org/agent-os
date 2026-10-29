/**
 * Sends queued messages when their session is ready (flag `queue`): one
 * item per idle edge from lib/session-watch.ts, plus a 2s re-check of
 * sessions with pending items. Started by lib/tickers.ts.
 */

import { getDb, queries, type Session } from "../db";
import { claudeHookAt } from "../claude-state";
import { flagOnFor, getFlags, tickersDisabled } from "../flags";
import { readiness, type Readiness } from "../session-ready";
import { onEdge, type WatchEdge } from "../session-watch";
import { sendText } from "../tmux-send";
import { beforeAgentSend } from "../turns";
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
   * while another look holds the lock. A pending permission mode is left to
   * the user's own restart: the session is never restarted from here
   */
  async function service(sessionId: string): Promise<void> {
    if (state.locks.has(sessionId)) return;
    await withLock(sessionId, async () => {
      const session = deps.getSession(sessionId);
      if (!session) return;
      const head = store.head(sessionId);
      if (!head) return;
      // autoResume gates the scheduled resume, not the user's Resume now
      const on =
        head.kind === "resume"
          ? head.origin === "user" || !!deps.resumeOn?.()
          : deps.queueOn(sessionId);
      if (!on) return;
      if (head.notBefore !== null && head.notBefore > deps.now()) return;
      if (awaiting(sessionId)) {
        await read(session);
        return;
      }
      if (!(await readyTwice(session, CONFIRM_MS))) return;

      const item = store.claimNext(sessionId, deps.now());
      if (!item) return;
      await deliver(session, item);
    });
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

  return { service, sendOrQueue, handleEdge, recheck };
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
    },
    shared.__agentosDispatch.state
  );
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
