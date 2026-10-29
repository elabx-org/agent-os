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
    store.setUndoNotice("s1", "[Agent-OS: undone]");
    add("s1", "carry on", { attachments: ["/tmp/a.png"] });
    await h.d.service("s1");
    assert.deepEqual(h.sent, [
      { id: "s1", text: "[Agent-OS: undone] carry on /tmp/a.png" },
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
