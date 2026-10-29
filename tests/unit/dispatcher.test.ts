import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Session } from "../../lib/db";
import type { Readiness } from "../../lib/session-ready";
import type { HoldReason } from "../../lib/queue/types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-dispatch-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let store: typeof import("../../lib/queue/store");
let dispatch: typeof import("../../lib/queue/dispatcher");
let db: typeof import("../../lib/db");

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/queue/store");
  dispatch = await import("../../lib/queue/dispatcher");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().exec("DELETE FROM session_queue");
});

const READY: Readiness = { ready: true, holdReason: null };
const hold = (holdReason: HoldReason): Readiness => ({
  ready: false,
  holdReason,
});

const session = (id: string, over: Partial<Session> = {}) =>
  ({ id, agent_type: "claude", permission_pending: null, ...over }) as Session;

/** A dispatcher on fakes: scripted readiness, a recording sender */
function harness(
  opts: {
    sessions?: Session[];
    queueStore?: import("../../lib/queue/store").QueueStore;
    sent?: { id: string; text: string }[];
    state?: import("../../lib/queue/dispatcher").DispatcherState;
    /** Sessions being pasted into now, shared to catch overlapping pastes */
    pasting?: Set<string>;
    overlaps?: string[];
    /** The agent's last hook event (ms) */
    hookAt?: () => number | null;
    /** The pending permission mode hook (lib/permission-apply) */
    applyPendingMode?: (session: Session) => Promise<unknown>;
    /** Runs a claimed move item (M5) */
    runMove?: (
      session: Session,
      item: import("../../lib/queue/types").QueueItem
    ) => Promise<void>;
  } = {}
) {
  const pasting = opts.pasting ?? new Set<string>();
  const overlaps = opts.overlaps ?? [];
  let pastes = 0;
  const sessions = new Map(
    (opts.sessions ?? [session("s1")]).map((s) => [s.id, s])
  );
  const sent = opts.sent ?? [];
  const reads = new Map<string, Readiness[]>();
  const fallback = new Map<string, Readiness>();
  const calls: string[] = [];
  const clock = { now: 1_000_000 };
  let sendError: Error | null = null;
  const queueOff = new Set<string>();
  const d = dispatch.createDispatcher(
    {
      store: opts.queueStore ?? store.queueStore(),
      getSession: (id) => sessions.get(id) ?? null,
      readiness: async (s) => {
        calls.push(`read:${s.id}`);
        const script = reads.get(s.id);
        return script?.length ? script.shift()! : (fallback.get(s.id) ?? READY);
      },
      send: async (s, text) => {
        calls.push(`send:${s.id}`);
        if (pasting.has(s.id)) overlaps.push(text);
        pasting.add(s.id);
        // Yield a varying while, as a real paste does, so racing callers
        // interleave
        for (let i = 0; i < 1 + (pastes++ % 4); i++)
          await new Promise((r) => setImmediate(r));
        pasting.delete(s.id);
        if (sendError) throw sendError;
        sent.push({ id: s.id, text });
      },
      queueOn: (id) => !queueOff.has(id),
      beforeAgentSend: async (s) => {
        calls.push(`snapshot:${s.id}`);
      },
      now: () => clock.now,
      sleep: () => new Promise((r) => setImmediate(r)),
      ...(opts.hookAt && { hookAt: opts.hookAt }),
      ...(opts.applyPendingMode && {
        applyPendingMode: opts.applyPendingMode,
      }),
      ...(opts.runMove && { runMove: opts.runMove }),
    },
    opts.state
  );
  return {
    d,
    sent,
    calls,
    clock,
    sessions,
    script: (id: string, ...r: Readiness[]) => reads.set(id, r),
    always: (id: string, r: Readiness) => fallback.set(id, r),
    failSends: (e: Error | null) => (sendError = e),
    queueOff,
  };
}

const add = (id: string, text: string, extra = {}) =>
  store.enqueue(id, { text, origin: "user", ...extra });

/** Lets a started move (not awaited by service) settle */
const settle = () => new Promise((r) => setImmediate(r));

describe("dispatcher", () => {
  test("sends the head after two ready reads and a last one", async () => {
    const h = harness();
    const a = add("s1", "one");
    add("s1", "two");
    await h.d.service("s1");
    assert.deepEqual(h.sent, [{ id: "s1", text: "one" }]);
    assert.deepEqual(h.calls, ["read:s1", "read:s1", "read:s1", "send:s1"]);
    assert.equal(store.queueStore().getItem("s1", a.id)?.status, "sent");
    assert.deepEqual(
      store.listQueue("s1").map((i) => [i.text, i.position]),
      [["two", 1]]
    );
  });

  test("the next waits until the agent was seen busy, or 20s", async () => {
    const h = harness();
    add("s1", "one");
    add("s1", "two");
    await h.d.service("s1");
    await h.d.service("s1");
    assert.equal(h.sent.length, 1, "not before it picked up the first");
    // Seen busy: the next goes once it's ready again
    h.script("s1", hold("busy"));
    await h.d.service("s1");
    await h.d.service("s1");
    assert.equal(h.sent.length, 2);
    // Or the wait runs out
    add("s1", "three");
    h.clock.now += 20_001;
    await h.d.service("s1");
    assert.equal(h.sent.length, 3);
  });

  test("a hook event after the send ends the wait (a turn too short to see)", async () => {
    let hookAt: number | null = null;
    const h = harness({ hookAt: () => hookAt });
    add("s1", "one");
    add("s1", "two");
    hookAt = h.clock.now - 5; // before the send: not its pickup
    await h.d.service("s1");
    await h.d.service("s1");
    assert.equal(h.sent.length, 1);
    hookAt = h.clock.now + 1;
    await h.d.service("s1");
    assert.equal(h.sent.length, 2);
  });

  test("an edge to running ends the wait", async () => {
    const h = harness();
    add("s1", "one");
    add("s1", "two");
    await h.d.service("s1");
    h.d.handleEdge({
      tmuxName: "claude-s1",
      sessionId: "s1",
      from: "waiting",
      to: "running",
      workedMs: 0,
      at: 0,
    });
    await h.d.service("s1");
    assert.equal(h.sent.length, 2);
  });

  test("flapping: the two reads must agree", async () => {
    const h = harness();
    add("s1", "one");
    h.script("s1", READY, hold("busy"));
    await h.d.service("s1");
    h.script("s1", hold("busy"), READY);
    await h.d.service("s1");
    assert.equal(h.sent.length, 0);
    assert.equal(store.listQueue("s1")[0].status, "pending");
  });

  for (const reason of ["asking", "permission", "typing", "unknown"] as const) {
    test(`held while ${reason}`, async () => {
      const h = harness();
      add("s1", "one");
      h.always("s1", hold(reason));
      await h.d.service("s1");
      await h.d.recheck();
      assert.equal(h.sent.length, 0);
    });
  }

  test("not ready right before the paste: back to pending", async () => {
    const h = harness();
    add("s1", "one");
    store.setUndoNotice("s1", "[notice]");
    h.script("s1", READY, READY, hold("typing"));
    await h.d.service("s1");
    assert.equal(h.sent.length, 0);
    assert.equal(store.listQueue("s1")[0].status, "pending");
    assert.equal(store.getUndoNotice("s1")?.text, "[notice]");
  });

  test("the undo notice rides on the next message, attachments after", async () => {
    const h = harness();
    store.setUndoNotice("s1", "[AgentOS: undone]");
    add("s1", "carry on", { attachments: ["/tmp/a.png"] });
    await h.d.service("s1");
    assert.deepEqual(h.sent, [
      { id: "s1", text: "[AgentOS: undone] carry on /tmp/a.png" },
    ]);
    assert.equal(store.getUndoNotice("s1"), null);
  });

  test("a command goes as it is, the notice waits", async () => {
    const h = harness();
    store.setUndoNotice("s1", "[notice]");
    add("s1", "/model sonnet", { kind: "command" });
    await h.d.service("s1");
    assert.deepEqual(h.sent, [{ id: "s1", text: "/model sonnet" }]);
    assert.equal(store.getUndoNotice("s1")?.text, "[notice]");
  });

  test("a slash command or ! line typed as a message keeps it waiting", async () => {
    const h = harness();
    store.setUndoNotice("s1", "[notice]");
    add("s1", "/clear");
    add("s1", "  ! ls");
    add("s1", "carry on");
    for (let i = 0; i < 3; i++) {
      await h.d.service("s1");
      h.clock.now += 30_000;
    }
    assert.deepEqual(
      h.sent.map((s) => s.text),
      ["/clear", "  ! ls", "[notice] carry on"]
    );
    assert.equal(store.getUndoNotice("s1"), null);
  });

  test("a notice alone is never sent", async () => {
    const h = harness();
    store.setUndoNotice("s1", "[notice]");
    await h.d.recheck();
    await h.d.service("s1");
    assert.equal(h.sent.length, 0);
  });

  test("notBefore holds the head", async () => {
    const h = harness();
    add("s1", "later", { notBefore: 1_000_000 + 5000 });
    await h.d.service("s1");
    assert.equal(h.sent.length, 0);
    h.clock.now += 5000;
    await h.d.service("s1");
    assert.equal(h.sent.length, 1);
  });

  test("a failed send is marked failed and keeps the notice", async () => {
    const h = harness();
    store.setUndoNotice("s1", "[notice]");
    const a = add("s1", "one");
    h.failSends(new Error("can't find session"));
    await assert.rejects(h.d.service("s1"));
    const item = store.queueStore().getItem("s1", a.id);
    assert.equal(item?.status, "failed");
    assert.equal(item?.error, "can't find session");
    assert.equal(store.getUndoNotice("s1")?.text, "[notice]");
  });

  test("Codex and Gemini take their pre snapshot before the paste", async () => {
    const h = harness({
      sessions: [session("cx", { agent_type: "codex" }), session("s1")],
    });
    add("cx", "go");
    add("s1", "go");
    await h.d.service("cx");
    await h.d.service("s1");
    assert.deepEqual(
      h.calls.filter((c) => !c.startsWith("read")),
      ["snapshot:cx", "send:cx", "send:s1"]
    );
  });

  test("nothing happens with the queue off for the session", async () => {
    const h = harness();
    add("s1", "one");
    h.queueOff.add("s1");
    await h.d.recheck();
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.length, 0);
  });

  test("a pending permission mode alone never touches the session", async () => {
    // The user may have cancelled the restart: only they restart it
    const h = harness({
      sessions: [session("s1", { permission_pending: "bypassPermissions" })],
    });
    await h.d.recheck();
    await h.d.service("s1");
    assert.deepEqual(h.calls, []);
    // Its queue still goes as usual
    add("s1", "one");
    await h.d.service("s1");
    assert.deepEqual(h.sent, [{ id: "s1", text: "one" }]);
  });

  test("a pending mode is applied before the send, in its lock", async () => {
    const order: string[] = [];
    const h = harness({
      sessions: [session("s1", { permission_pending: "auto" })],
      applyPendingMode: async (s) => {
        order.push(`mode:${s.permission_pending}`);
      },
    });
    add("s1", "one");
    await h.d.service("s1");
    assert.deepEqual(order, ["mode:auto"]);
    // Applied before the paste, after the two ready reads
    const send = h.calls.indexOf("send:s1");
    assert.ok(send > 0);
    assert.deepEqual(h.sent, [{ id: "s1", text: "one" }]);
  });

  test("a failing pending-mode apply never holds the send back", async () => {
    const h = harness({
      sessions: [session("s1", { permission_pending: "auto" })],
      applyPendingMode: async () => {
        throw new Error("tmux");
      },
    });
    add("s1", "one");
    const error = console.error;
    console.error = () => {};
    try {
      await h.d.service("s1");
    } finally {
      console.error = error;
    }
    assert.deepEqual(h.sent, [{ id: "s1", text: "one" }]);
  });

  test("no pending mode: the hook is not called", async () => {
    let called = 0;
    const h = harness({
      applyPendingMode: async () => called++,
    });
    add("s1", "one");
    await h.d.service("s1");
    assert.equal(called, 0);
    assert.equal(h.sent.length, 1);
  });

  test("applyPending waits for a send in progress, then applies", async () => {
    const order: string[] = [];
    const h = harness({
      sessions: [session("s1", { permission_pending: "auto" })],
      applyPendingMode: async (s) => {
        order.push(`mode:${s.permission_pending}`);
        // Applied: the row's pending mode is cleared
        h.sessions.set("s1", session("s1"));
      },
    });
    add("s1", "one");
    // The send's own pre-send apply runs first; the edge's apply then
    // sees the cleared pending mode and does nothing
    const sending = h.d.service("s1");
    const applying = h.d.applyPending("s1").then(() => order.push("edge"));
    await Promise.all([sending, applying]);
    assert.deepEqual(order, ["mode:auto", "edge"]);
    assert.equal(h.sent.length, 1);
  });

  test("applyPending applies with nothing queued, never sends", async () => {
    const seen: string[] = [];
    const h = harness({
      sessions: [session("s1", { permission_pending: "acceptEdits" })],
      applyPendingMode: async (s) => seen.push(s.id),
    });
    await h.d.applyPending("s1");
    assert.deepEqual(seen, ["s1"]);
    assert.deepEqual(h.sent, []);
    // Nothing pending: not called
    h.sessions.set("s1", session("s1"));
    await h.d.applyPending("s1");
    assert.deepEqual(seen, ["s1"]);
  });

  test("idle edges trigger a send", async () => {
    const h = harness();
    add("s1", "one");
    h.d.handleEdge({
      tmuxName: "claude-s1",
      sessionId: "s1",
      from: "running",
      to: "waiting",
      workedMs: 30_000,
      at: 0,
    });
    for (let i = 0; i < 20 && !h.sent.length; i++)
      await new Promise((r) => setImmediate(r));
    assert.equal(h.sent.length, 1);
  });
});

describe("sendOrQueue", () => {
  test("sends at once when ready and nothing is ahead", async () => {
    const h = harness();
    store.setUndoNotice("s1", "[notice]");
    const r = await h.d.sendOrQueue(
      session("s1"),
      { text: "hi", sendNow: true },
      "user"
    );
    assert.equal(r.sent, true);
    assert.equal(r.item.status, "sent");
    assert.deepEqual(h.sent, [{ id: "s1", text: "[notice] hi" }]);
  });

  test("queues behind pending items, so it can't overtake them", async () => {
    const h = harness();
    add("s1", "first");
    const r = await h.d.sendOrQueue(
      session("s1"),
      { text: "second", sendNow: true },
      "user"
    );
    assert.equal(r.sent, false);
    assert.equal(r.item.position, 2);
    assert.equal(h.sent.length, 0);
  });

  test("queues when not ready, or not asked to send now", async () => {
    const h = harness();
    h.always("s1", hold("busy"));
    const busy = await h.d.sendOrQueue(
      session("s1"),
      { text: "a", sendNow: true },
      "user"
    );
    const later = await h.d.sendOrQueue(
      session("s1"),
      { text: "b", kind: "command" },
      "agent"
    );
    assert.deepEqual([busy.sent, later.sent], [false, false]);
    assert.equal(later.item.kind, "command");
    assert.equal(later.item.origin, "agent");
    assert.deepEqual(
      store.listQueue("s1").map((i) => i.text),
      ["a", "b"]
    );
  });

  test("right after a send, the next one queues", async () => {
    const h = harness();
    const first = await h.d.sendOrQueue(
      session("s1"),
      { text: "a", sendNow: true },
      "user"
    );
    const second = await h.d.sendOrQueue(
      session("s1"),
      { text: "b", sendNow: true },
      "user"
    );
    assert.deepEqual([first.sent, second.sent], [true, false]);
  });
});

describe("two dispatchers on one DB", () => {
  test("never send an item twice, and keep the order", async () => {
    const sent: { id: string; text: string }[] = [];
    const pasting = new Set<string>();
    const overlaps: string[] = [];
    const a = harness({ sent, pasting, overlaps });
    const b = harness({
      sent,
      pasting,
      overlaps,
      queueStore: store.createQueueStore(
        new Database(process.env.DB_PATH!, { timeout: 10_000 })
      ),
    });
    // Neither waits for busy, to race as hard as possible
    for (const h of [a, b]) h.clock.now = 0;
    const texts = Array.from({ length: 12 }, (_, i) => `m${i}`);
    for (const t of texts.slice(0, 6)) add("s1", t);
    const work: Promise<unknown>[] = [];
    for (let round = 0; round < 30; round++) {
      a.clock.now += 20_001;
      b.clock.now += 20_001;
      work.push(a.d.service("s1"), b.d.service("s1"), a.d.recheck());
      if (round < 6) {
        const h = round % 2 ? a : b;
        work.push(
          h.d.sendOrQueue(
            session("s1"),
            { text: texts[6 + round], sendNow: true },
            "user"
          )
        );
      }
      await Promise.all(work.splice(0));
    }
    assert.deepEqual(
      sent.map((s) => s.text),
      texts
    );
    assert.deepEqual(overlaps, [], "one paste at a time per session");
  });
});

describe("dispatcher: scheduled moves (M5)", () => {
  const schedule = (id = "s1") =>
    store.queueStore().scheduleMove(id, '{"v":1}')!;

  test("a move is run, never typed in, ahead of queued messages", async () => {
    const moved: number[] = [];
    let pending = 0;
    const h = harness({
      runMove: async (_s, item) => {
        moved.push(item.id);
        pending =
          store.queueStore().getItem("s1", item.id)!.status === "sending"
            ? 1
            : 0;
      },
    });
    add("s1", "after the move");
    const move = schedule();
    // Hidden from the composer's list, but ahead of a send now
    assert.deepEqual(
      store.listQueue("s1").map((i) => [i.text, i.position]),
      [["after the move", 1]]
    );
    assert.equal(store.queueStore().hasActive("s1"), true);
    assert.equal(store.queueStore().head("s1")?.id, move.id);
    store
      .queueStore()
      .setUndoNotice("s1", "[AgentOS: the user undid turn 1; a is back.]");

    await h.d.service("s1");
    await settle();
    assert.deepEqual(moved, [move.id]);
    assert.equal(pending, 1, "claimed (sending) while it runs");
    assert.deepEqual(h.sent, [], "nothing typed for the move");
    assert.ok(!h.calls.some((c) => c.startsWith("snapshot:")));
    assert.equal(store.queueStore().getItem("s1", move.id)?.status, "sent");
    assert.ok(store.getUndoNotice("s1"), "the undo notice waits for a message");

    await h.d.service("s1");
    const sent = h.sent as { id: string; text: string }[];
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /after the move$/);
  });

  test("goes with the queue flag off; messages behind it still wait", async () => {
    const moved: number[] = [];
    const h = harness({
      runMove: async (_s, item) => {
        moved.push(item.id);
      },
    });
    h.queueOff.add("s1");
    add("s1", "queued");
    const move = schedule();
    await h.d.service("s1");
    await h.d.service("s1");
    assert.deepEqual(moved, [move.id]);
    assert.deepEqual(h.sent, []);
  });

  test("only after two ready reads", async () => {
    const moved: number[] = [];
    const h = harness({ runMove: async (_s, i) => void moved.push(i.id) });
    schedule();
    h.script("s1", READY, hold("busy"));
    await h.d.service("s1");
    assert.deepEqual(moved, []);
  });

  test("waits when there is no runner", async () => {
    const h = harness();
    const move = schedule();
    add("s1", "behind");
    await h.d.service("s1");
    assert.equal(store.queueStore().getItem("s1", move.id)?.status, "pending");
    assert.deepEqual(h.sent, []);
  });

  test("a failed move is marked failed, with why, and kept out of the composer", async () => {
    const h = harness({
      runMove: async () => {
        throw new Error("The worktree doesn't match the changes");
      },
    });
    const move = schedule();
    const errors = console.error;
    console.error = () => {};
    try {
      await h.d.service("s1");
      await settle();
    } finally {
      console.error = errors;
    }
    const item = store.queueStore().getItem("s1", move.id)!;
    assert.equal(item.status, "failed");
    assert.equal(item.error, "The worktree doesn't match the changes");
    assert.deepEqual(h.sent, []);
    assert.deepEqual(store.queueStore().listFailed("s1", 0), []);
    assert.equal(store.queueStore().hasActive("s1"), false);
  });

  test("a build without M5 holds a move row instead of typing it in", () => {
    const q = store.queueStore();
    const move = schedule();
    // The pre-M5 dispatcher's head and claim: first pending by position,
    // held while notBefore is in the future
    const oldHead = db
      .getDb()
      .prepare(
        `SELECT * FROM session_queue WHERE session_id = ? AND status = 'pending'
           AND kind != 'undo_notice' ORDER BY position, id`
      )
      .get("s1") as { id: number; not_before: number | null };
    assert.equal(oldHead.id, move.id);
    const farFuture = Date.UTC(9999, 0, 1);
    assert.ok(oldHead.not_before !== null && oldHead.not_before > farFuture);
    // This build claims it all the same
    assert.equal(q.claimNext("s1", Date.now())?.id, move.id);
    const running = q.startMove("s2", "{}")!;
    assert.ok((running.notBefore ?? 0) > farFuture);
  });

  test("one move per session; a restart fails a running move on its own", () => {
    const q = store.queueStore();
    const move = schedule();
    assert.equal(q.scheduleMove("s1", "{}"), null);
    assert.equal(q.startMove("s1", "{}"), null);
    assert.deepEqual(
      q.pendingMoves().map((i) => i.id),
      [move.id]
    );
    q.claimNext("s1");
    add("s1", "typed");
    assert.equal(q.claimNext("s1"), null, "nothing else while it runs");
    assert.equal(q.failInterrupted(), 0, "left to failInterruptedMoves");
    const cut = q.failInterruptedMoves();
    assert.deepEqual(
      cut.map((i) => [i.id, i.status]),
      [[move.id, "failed"]]
    );
    assert.equal(q.getItem("s1", move.id)?.status, "failed");
  });
});

describe("dispatcher: performance budget (plan 0.5)", () => {
  test("a re-check of 20 sessions takes < 50ms CPU", async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => session(`p${i}`));
    const h = harness({ sessions });
    for (const s of sessions) {
      add(s.id, "queued");
      h.always(s.id, hold("busy"));
    }
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      const start = process.cpuUsage();
      await h.d.recheck();
      const used = process.cpuUsage(start);
      worst = Math.max(worst, (used.user + used.system) / 1000);
    }
    assert.ok(worst < 50, `worst re-check ${worst.toFixed(2)}ms`);
  });
});
