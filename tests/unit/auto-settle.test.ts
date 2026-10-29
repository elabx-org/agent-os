import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { AutoSettleDeps } from "../../lib/auto-settle";
import type { AutoSettleInput } from "../../lib/settle-types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-autosettle-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let auto: typeof import("../../lib/auto-settle");
let settle: typeof import("../../lib/settle");
let types: typeof import("../../lib/settle-types");

before(async () => {
  db = await import("../../lib/db");
  auto = await import("../../lib/auto-settle");
  settle = await import("../../lib/settle");
  types = await import("../../lib/settle-types");
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

const NOW = Date.parse("2026-10-29T12:00:00Z");
const MIN = 60_000;

describe("autoSettleBlock", () => {
  const base = (patch: Partial<AutoSettleInput> = {}): AutoSettleInput => ({
    session: {
      settled_at: null,
      settled_reason: null,
      paused_at: null,
      pr_status: "merged",
    },
    autoSettleOn: true,
    status: "idle",
    pendingQueue: 0,
    lastInputAt: NOW - 31 * MIN,
    focused: false,
    now: NOW,
    ...patch,
  });
  const session = (patch: Partial<AutoSettleInput["session"]>) => ({
    ...base().session,
    ...patch,
  });

  test("idle, quiet, unqueued, unfocused: settles", () => {
    assert.equal(auto.autoSettleBlock(base()), null);
    assert.equal(auto.autoSettleBlock(base({ status: "dead" })), null);
    assert.equal(auto.autoSettleBlock(base({ lastInputAt: null })), null);
  });

  test("each guard blocks, in order", () => {
    const cases: [Partial<AutoSettleInput>, string][] = [
      [{ session: session({ settled_at: NOW }) }, "ended"],
      [{ session: session({ paused_at: NOW }) }, "ended"],
      [
        { session: session({ settled_reason: types.UNSETTLED_REASON }) },
        "undone",
      ],
      [{ autoSettleOn: false }, "flag_off"],
      [{ status: "running" }, "not_idle"],
      [{ status: "waiting" }, "not_idle"],
      [{ status: null }, "not_idle"],
      [{ pendingQueue: 1 }, "queued"],
      [{ lastInputAt: NOW - 5 * MIN }, "recent_input"],
      [{ lastInputAt: NOW - types.AUTO_SETTLE_QUIET_MS + 1 }, "recent_input"],
      [{ focused: true }, "focused"],
      [{ session: session({ settled_at: NOW }), autoSettleOn: false }, "ended"],
      [{ status: "running", focused: true }, "not_idle"],
    ];
    for (const [patch, want] of cases)
      assert.equal(
        auto.autoSettleBlock(base(patch)),
        want,
        JSON.stringify(patch)
      );
  });
});

const raw = () => db.getDb();
const row = (id: string) =>
  db.queries.getSession(raw()).get(id) as Session | undefined;

let seq = 0;
/** A fresh id per test: the pass remembers what it settled */
function addMerged(patch: Record<string, unknown> = {}): string {
  const id = `s${++seq}`;
  raw()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, agent_type, branch_name, pr_number, pr_status)
       VALUES (?, ?, ?, 'claude', 'feat/x', 7, 'merged')`
    )
    .run(id, id, `claude-${id}`);
  for (const [key, value] of Object.entries(patch))
    raw().prepare(`UPDATE sessions SET ${key} = ? WHERE id = ?`).run(value, id);
  return id;
}

beforeEach(() => {
  raw().exec("DELETE FROM sessions");
  raw().exec("DELETE FROM session_queue");
  raw().exec("DELETE FROM session_turns");
});

function deps(patch: Partial<AutoSettleDeps> = {}) {
  const settled: string[] = [];
  const d: AutoSettleDeps = {
    db: raw(),
    autoSettleOn: () => true,
    status: async () => "idle",
    pendingQueue: () => 0,
    lastInputAt: async () => NOW - 60 * MIN,
    focused: () => false,
    settle: async (session, options) => {
      settled.push(session.id);
      assert.deepEqual(options, { reason: "pr_merged", force: false });
      raw()
        .prepare(
          "UPDATE sessions SET settled_at = ?, settled_reason = ? WHERE id = ?"
        )
        .run(NOW, options.reason, session.id);
      return row(session.id)!;
    },
    now: () => NOW,
    ...patch,
  };
  return { d, settled };
}

describe("autoSettlePass", () => {
  test("settles a safe merged session once", async () => {
    const id = addMerged();
    const { d, settled } = deps();
    assert.equal(await auto.autoSettlePass(d), 1);
    assert.equal(await auto.autoSettlePass(d), 0);
    assert.deepEqual(settled, [id]);
    assert.equal(row(id)!.settled_reason, "pr_merged");
  });

  test("busy, queued, recently used or focused sessions keep the chip", async () => {
    const busy = addMerged();
    const queued = addMerged();
    const recent = addMerged();
    const focused = addMerged();
    const { d, settled } = deps({
      status: async (s) => (s.id === busy ? "running" : "idle"),
      pendingQueue: (id) => (id === queued ? 2 : 0),
      lastInputAt: async (s) => (s.id === recent ? NOW - 2 * MIN : null),
      focused: (id) => id === focused,
    });
    assert.equal(await auto.autoSettlePass(d), 0);
    assert.deepEqual(settled, []);
    for (const id of [busy, queued, recent, focused]) {
      const s = row(id)!;
      assert.equal(s.settled_at, null);
      assert.equal(types.wantsSettleChip(s), true);
    }
  });

  test("autoSettle off: nothing is weighed", async () => {
    addMerged();
    let asked = 0;
    const { d, settled } = deps({
      autoSettleOn: () => false,
      status: async () => {
        asked++;
        return "idle";
      },
    });
    assert.equal(await auto.autoSettlePass(d), 0);
    assert.equal(asked, 0);
    assert.deepEqual(settled, []);
  });

  test("undone, paused, settled and unmerged sessions are left alone", async () => {
    addMerged({ settled_reason: types.UNSETTLED_REASON });
    addMerged({ paused_at: NOW });
    addMerged({ settled_at: NOW, settled_reason: "manual" });
    addMerged({ pr_status: "open" });
    const { d, settled } = deps();
    assert.equal(await auto.autoSettlePass(d), 0);
    assert.deepEqual(settled, []);
  });

  test("a busy refusal from settle counts as blocked, the next one still goes", async () => {
    const refused = addMerged();
    const fine = addMerged();
    const { d, settled } = deps();
    const inner = d.settle;
    d.settle = async (session, options) => {
      if (session.id === refused)
        throw new settle.SettleRefused(409, { error: "Busy", reason: "busy" });
      return inner(session, options);
    };
    assert.equal(await auto.autoSettlePass(d), 1);
    assert.deepEqual(settled, [fine]);
    assert.equal(row(refused)!.settled_at, null);
  });
});

describe("lastDbInputAt", () => {
  test("the latest user message or turn start", () => {
    const id = addMerged();
    assert.equal(auto.lastDbInputAt(raw(), id), null);
    const q = raw().prepare(
      `INSERT INTO session_queue (session_id, position, text, origin, kind, status, created_at)
       VALUES (?, 0, 'x', ?, 'message', 'sent', ?)`
    );
    q.run(id, "user", NOW - 40 * MIN);
    // The system's own resume isn't the user's
    q.run(id, "system", NOW - 1 * MIN);
    assert.equal(auto.lastDbInputAt(raw(), id), NOW - 40 * MIN);
    raw()
      .prepare(
        `INSERT INTO session_turns (session_id, turn_no, cwd, started_at)
         VALUES (?, 1, '/tmp', ?)`
      )
      .run(id, NOW - 10 * MIN);
    assert.equal(auto.lastDbInputAt(raw(), id), NOW - 10 * MIN);
  });
});
