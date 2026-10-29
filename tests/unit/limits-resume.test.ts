import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Session } from "../../lib/db";
import type { Readiness } from "../../lib/session-ready";
import type { UsageResponse } from "../../lib/claude-usage";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-resume-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let store: typeof import("../../lib/queue/store");
let dispatch: typeof import("../../lib/queue/dispatcher");
let resume: typeof import("../../lib/limits/resume");
let types: typeof import("../../lib/limits/types");
let ready: typeof import("../../lib/session-ready");

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/queue/store");
  dispatch = await import("../../lib/queue/dispatcher");
  resume = await import("../../lib/limits/resume");
  types = await import("../../lib/limits/types");
  ready = await import("../../lib/session-ready");
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

// Real time: the queue stamps created_at with Date.now()
const BASE = Date.now();
const UNTIL = BASE + 60 * 60_000;

beforeEach(() => {
  const d = db.getDb();
  d.exec("DELETE FROM session_queue");
  d.exec("DELETE FROM sessions");
  for (const id of ["s1", "s2", "s3"]) {
    d.prepare(
      "INSERT INTO sessions (id, name, tmux_name, agent_type) VALUES (?, ?, ?, ?)"
    ).run(id, id, `claude-${id}`, "claude");
  }
});

const raw = (): Database.Database => db.getDb();
const row = (id: string) =>
  db.queries.getSession(raw()).get(id) as Session | undefined;

function limit(id: string, until: number | null = UNTIL, at = BASE - 60_000) {
  raw()
    .prepare(
      "UPDATE sessions SET limited_at = ?, limited_until = ?, limit_kind = 'session' WHERE id = ?"
    )
    .run(at, until, id);
  return row(id)!;
}

function harness(
  opts: { autoResume?: boolean; queue?: boolean; wentOn?: Set<string> } = {}
) {
  const resumedIds: string[] = [];
  const kicked: string[] = [];
  let usage: UsageResponse | null = null;
  const flags = { autoResume: opts.autoResume ?? true };
  const r = resume.createResume({
    db: raw(),
    kick: (id) => kicked.push(id),
    usage: () => usage,
    resumeOn: () => flags.autoResume,
  });
  const clock = { now: BASE };
  const sent: { id: string; text: string }[] = [];
  const screens = new Map<string, Readiness>();
  const d = dispatch.createDispatcher({
    store: store.queueStore(raw()),
    getSession: (id) => row(id) ?? null,
    // As lib/session-ready.ts: a limit holds first, then the screen
    readiness: async (s) =>
      types.limitStateOf(s, clock.now).limited
        ? { ready: false, holdReason: "limited" }
        : (screens.get(s.id) ?? { ready: true, holdReason: null }),
    send: async (s, text) => {
      sent.push({ id: s.id, text });
    },
    queueOn: () => opts.queue ?? false,
    resumeOn: () => flags.autoResume,
    beforeAgentSend: async () => {},
    now: () => clock.now,
    sleep: () => new Promise((res) => setImmediate(res)),
    dropStaleResume: (s, item) => {
      if (!opts.wentOn?.has(s.id)) return false;
      store.queueStore(raw()).cancelItem(s.id, item.id);
      return true;
    },
    resumed: (s) => resumedIds.push(s.id),
  });
  return {
    r,
    d,
    clock,
    sent,
    kicked,
    flags,
    resumedIds,
    screen: (id: string, x: Readiness | null) =>
      x ? screens.set(id, x) : screens.delete(id),
    setUsage: (u: UsageResponse | null) => (usage = u),
  };
}

const usageWith = (resetsAt: number): UsageResponse => ({
  five_hour: { utilization: 100, resets_at: new Date(resetsAt).toISOString() },
  seven_day: { utilization: 40, resets_at: null },
  seven_day_sonnet: null,
  seven_day_opus: null,
  extra_usage: {
    is_enabled: false,
    utilization: null,
    used_credits: null,
    monthly_limit: null,
  },
  plan: "max",
});

describe("staggeredResumeAt", () => {
  test("the reset plus the grace when nothing else is due", () => {
    assert.equal(resume.staggeredResumeAt(1000, []), 31_000);
    assert.equal(resume.staggeredResumeAt(1000, [100_000, -50_000]), 31_000);
  });

  test("20s after a resume it would come too close to", () => {
    assert.equal(resume.staggeredResumeAt(1000, [31_000]), 51_000);
    assert.equal(resume.staggeredResumeAt(1000, [25_000]), 45_000);
    // A chain: each pushes it further
    assert.equal(resume.staggeredResumeAt(1000, [31_000, 51_000]), 71_000);
    assert.equal(
      resume.staggeredResumeAt(1000, [71_000, 31_000, 51_000]),
      91_000
    );
    // Exactly 20s apart is far enough
    assert.equal(resume.staggeredResumeAt(1000, [11_000, 51_000]), 31_000);
  });
});

describe("scheduleResume", () => {
  test("reset: policy at_reset, one resume item at the reset + 30s", async () => {
    const h = harness();
    const res = await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    assert.equal(res.state.policy, "at_reset");
    assert.equal(res.state.resumeText, "continue");
    assert.equal(res.item?.kind, "resume");
    assert.equal(res.item?.origin, "system");
    assert.equal(res.item?.text, "continue");
    assert.equal(res.item?.notBefore, UNTIL + 30_000);
    // Again with a text: replaced, never two
    const again = await h.r.scheduleResume(
      row("s1")!,
      { when: "reset", text: "carry on" },
      BASE
    );
    assert.equal(again.item?.text, "carry on");
    assert.equal(h.r.pendingResume("s1")?.id, again.item?.id);
    assert.equal(
      store.listQueue("s1").filter((i) => i.kind === "resume").length,
      1
    );
  });

  test("resumes of different sessions go 20s apart", async () => {
    const h = harness();
    const a = await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    const b = await h.r.scheduleResume(limit("s2"), { when: "reset" }, BASE);
    const c = await h.r.scheduleResume(limit("s3"), { when: "reset" }, BASE);
    assert.deepEqual(
      [a, b, c].map((x) => x.item!.notBefore! - UNTIL),
      [30_000, 50_000, 70_000]
    );
  });

  test("not limited: refused; Resume now still goes with a policy set", async () => {
    const h = harness();
    await assert.rejects(
      h.r.scheduleResume(row("s1")!, { when: "reset" }, BASE),
      resume.NotLimitedError
    );
    // The reset has passed while snoozed
    limit("s1", BASE - 1000);
    raw()
      .prepare("UPDATE sessions SET resume_policy = 'snooze' WHERE id = 's1'")
      .run();
    await assert.rejects(
      h.r.scheduleResume(row("s1")!, { when: "reset" }, BASE),
      resume.NotLimitedError
    );
    const now = await h.r.scheduleResume(row("s1")!, { when: "now" }, BASE);
    assert.equal(now.item?.kind, "resume");
  });

  test("now: limit cleared, resume due at once, the dispatcher kicked", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    const res = await h.r.scheduleResume(
      row("s1")!,
      { when: "now", text: "go on" },
      BASE
    );
    assert.equal(res.state.limited, false);
    assert.equal(res.state.limitedAt, null);
    assert.equal(res.item?.notBefore, null);
    assert.deepEqual(h.kicked, ["s1"]);
    assert.equal(h.r.pendingResume("s1")?.id, res.item?.id);
    await h.d.service("s1");
    assert.deepEqual(h.sent, [{ id: "s1", text: "go on" }]);
  });

  test("snooze: nothing queued, a pending resume cancelled", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    const res = await h.r.scheduleResume(row("s1")!, { when: "snooze" }, BASE);
    assert.equal(res.state.policy, "snooze");
    assert.equal(res.state.limited, true);
    assert.equal(res.item, null);
    assert.equal(h.r.pendingResume("s1"), null);
    // Nothing goes at the reset
    h.clock.now = UNTIL + 60_000;
    h.r.resumeTick(h.clock.now);
    await h.d.recheck();
    assert.deepEqual(h.sent, []);
    // and the snooze ends with it
    assert.equal(row("s1")!.limited_at, null);
    assert.equal(row("s1")!.resume_policy, null);
  });

  test("cancel: the item and the policy go, the limit stays", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    const res = h.r.cancelResume(row("s1")!, BASE);
    assert.equal(res.item, null);
    assert.equal(res.state.policy, null);
    assert.equal(res.state.limited, true);
    assert.equal(h.r.pendingResume("s1"), null);
    h.clock.now = UNTIL + 60_000;
    h.r.resumeTick(h.clock.now);
    await h.d.recheck();
    assert.deepEqual(h.sent, []);
  });
});

describe("resume at reset through the dispatcher", () => {
  test("goes once, only after the reset and only when ready", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    // Before the reset: limited, and not due
    await h.d.recheck();
    h.clock.now = UNTIL + 10_000;
    await h.d.recheck();
    assert.deepEqual(h.sent, []);
    // Due, but a permission prompt is on screen
    h.clock.now = UNTIL + 30_000;
    h.screen("s1", { ready: false, holdReason: "permission" });
    await h.d.recheck();
    h.screen("s1", { ready: false, holdReason: "asking" });
    await h.d.recheck();
    assert.deepEqual(h.sent, []);
    h.screen("s1", null);
    await h.d.recheck();
    assert.deepEqual(h.sent, [{ id: "s1", text: "continue" }]);
    // Once: neither the dispatcher nor the tick sends or queues it again
    h.clock.now += 60_000;
    h.r.resumeTick(h.clock.now);
    await h.d.recheck();
    assert.equal(h.sent.length, 1);
    assert.equal(h.r.pendingResume("s1"), null);
  });

  test("a restart between scheduling and the reset still resumes once", async () => {
    const first = harness();
    await first.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    // New process: fresh scheduler and dispatcher state, same DB
    const h = harness();
    h.r.resumeTick(BASE + 1000);
    assert.equal(
      store.listQueue("s1").filter((i) => i.kind === "resume").length,
      1
    );
    h.clock.now = UNTIL + 30_000;
    h.r.resumeTick(h.clock.now);
    await h.d.recheck();
    await h.d.recheck();
    assert.deepEqual(h.sent, [{ id: "s1", text: "continue" }]);
  });

  test("autoResume off: Resume at reset is refused, nothing queued", async () => {
    const h = harness({ autoResume: false, queue: true });
    await assert.rejects(
      h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE),
      resume.AutoResumeOffError
    );
    assert.equal(row("s1")!.resume_policy, null);
    assert.equal(store.listQueue("s1").length, 0);
  });

  test("autoResume switched off after scheduling: dropped, nothing typed, the queue behind it goes", async () => {
    const h = harness({ queue: true });
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    store.enqueue("s1", { text: "user msg", origin: "user" });
    h.flags.autoResume = false;
    h.clock.now = UNTIL + 60_000;
    await h.d.service("s1");
    await h.d.service("s1");
    assert.deepEqual(h.sent, [{ id: "s1", text: "user msg" }]);
    assert.equal(h.r.pendingResume("s1"), null);
    // Switched back on: the dropped one doesn't come back
    h.flags.autoResume = true;
    await h.d.recheck();
    assert.equal(h.sent.length, 1);
  });

  test("autoResume off: the tick takes the at_reset choices back", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    h.flags.autoResume = false;
    h.r.parkTick();
    assert.equal(row("s1")!.resume_policy, null);
    assert.equal(h.r.pendingResume("s1"), null);
  });

  test("a scheduled resume cancelled from the queue is not queued again", async () => {
    const h = harness();
    const res = await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    store.cancelItem("s1", res.item!.id);
    h.r.resumeTick(BASE + 1000);
    h.r.resumeTick(UNTIL + 30_000);
    assert.equal(h.r.pendingResume("s1"), null);
  });

  test("a resume long past its time that never went is dropped", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    h.r.resumeTick(UNTIL + 30_000 + resume.STALE_RESUME_MS + 1000);
    assert.equal(h.r.pendingResume("s1"), null);
    assert.equal(row("s1")!.resume_policy, null);
  });

  test("typed in: the dispatcher says resumed (a short turn has no busy edge)", async () => {
    const h = harness();
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    h.clock.now = UNTIL + 30_000;
    await h.d.service("s1");
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.resumedIds, ["s1"]);
  });

  test("went on without it: a stale scheduled resume is dropped, not typed", async () => {
    const h = harness({ wentOn: new Set(["s1"]) });
    await h.r.scheduleResume(limit("s1"), { when: "reset" }, BASE);
    h.clock.now = UNTIL + 30_000;
    await h.d.service("s1");
    assert.deepEqual(h.sent, []);
    assert.deepEqual(h.resumedIds, []);
    assert.equal(h.r.pendingResume("s1"), null);
  });

  test("autoResume off: Resume now, the user's click, still goes", async () => {
    const h = harness({ autoResume: false, queue: true });
    await h.r.scheduleResume(limit("s1"), { when: "now" }, BASE);
    await h.d.service("s1");
    assert.deepEqual(h.sent, [{ id: "s1", text: "continue" }]);
  });

  test("queue flag off: other messages wait, the resume still goes", async () => {
    const h = harness({ queue: false });
    await h.r.scheduleResume(limit("s1"), { when: "now" }, BASE);
    await h.d.service("s1");
    assert.equal(h.sent.length, 1);
    store.enqueue("s1", { text: "user msg", origin: "user" });
    h.clock.now += 60_000;
    await h.d.service("s1");
    assert.equal(h.sent.length, 1);
  });

  test("unknown reset: queued by the tick once the usage API says", async () => {
    const h = harness();
    const res = await h.r.scheduleResume(
      limit("s1", null),
      { when: "reset" },
      BASE
    );
    assert.equal(res.item, null);
    assert.equal(res.state.policy, "at_reset");
    h.r.resumeTick(BASE);
    assert.equal(h.r.pendingResume("s1"), null);
    // A reset from before the limit is an old window: ignored
    h.setUsage(usageWith(BASE - 120_000));
    h.r.resumeTick(BASE);
    assert.equal(h.r.pendingResume("s1"), null);
    h.setUsage(usageWith(UNTIL));
    h.r.resumeTick(BASE);
    h.r.resumeTick(BASE);
    assert.equal(row("s1")!.limited_until, UNTIL);
    assert.equal(h.r.pendingResume("s1")?.notBefore, UNTIL + 30_000);
    assert.equal(
      store.listQueue("s1").filter((i) => i.kind === "resume").length,
      1
    );
  });
});

describe("readiness", () => {
  test("a limited session is held before its screen is read (flag limits)", async () => {
    const flags = await import("../../lib/flags");
    const s = limit("s1", Date.now() + 60_000);
    flags.setFlags({ limits: true });
    assert.deepEqual(await ready.readiness(s), {
      ready: false,
      holdReason: "limited",
    });
    // The kill switch: off, a limit holds nothing
    flags.setFlags({ limits: false });
    assert.notEqual((await ready.readiness(s)).holdReason, "limited");
  });
});
