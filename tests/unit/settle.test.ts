import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { QueueItem } from "../../lib/queue/types";
import type { SettleDeps } from "../../lib/settle";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-settle-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let mod: typeof import("../../lib/settle");
let types: typeof import("../../lib/settle-types");
let queue: typeof import("../../lib/queue/store");

before(async () => {
  db = await import("../../lib/db");
  mod = await import("../../lib/settle");
  types = await import("../../lib/settle-types");
  queue = await import("../../lib/queue/store");
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
  db.getDb().exec("DELETE FROM sessions; DELETE FROM session_queue");
});

const worktree = path.join(tmp, "wt");
fs.mkdirSync(worktree, { recursive: true });

function addSession(
  id: string,
  extra: Partial<Record<keyof Session, unknown>> = {}
): Session {
  const d = db.getDb();
  db.queries
    .createSession(d)
    .run(
      id,
      `name-${id}`,
      `claude-${id}`,
      worktree,
      null,
      "opus",
      null,
      "sessions",
      "claude",
      0,
      0,
      "uncategorized"
    );
  for (const [key, value] of Object.entries(extra)) {
    d.prepare(`UPDATE sessions SET ${key} = ? WHERE id = ?`).run(value, id);
  }
  return row(id)!;
}

const row = (id: string) =>
  (db.queries.getSession(db.getDb()).get(id) as Session | undefined) ?? null;

interface Fake {
  deps: SettleDeps;
  calls: string[];
  status: Map<string, string>;
  running: Set<string>;
  launchFails: boolean;
}

function fake(): Fake {
  const calls: string[] = [];
  const status = new Map<string, string>();
  const running = new Set<string>();
  const f: Fake = { calls, status, running, launchFails: false, deps: null! };
  const store = queue.queueStore(db.getDb());
  f.deps = {
    db: db.getDb(),
    now: () => 1_700_000_000_000,
    status: (id) => status.get(id) ?? null,
    listQueue: (id) => store.listQueue(id),
    cancelItem: (id, itemId) => store.cancelItem(id, itemId),
    isRunning: async (s) => running.has(s.id),
    rememberTranscript: async (s) => {
      calls.push(`remember:${s.id}`);
      db.queries
        .updateSessionClaudeId(db.getDb())
        .run("11111111-2222-3333-4444-555555555555", s.id);
    },
    keepHistory: async (s) => {
      calls.push(`history:${s.id}`);
    },
    kill: async (s) => {
      // The row is already settled when tmux ends
      assert.ok(row(s.id)!.settled_at, "settled before the kill");
      calls.push(`kill:${s.id}`);
      running.delete(s.id);
    },
    launch: async (s) => {
      if (f.launchFails) throw new Error("tmux failed");
      calls.push(`launch:${s.id}:${s.claude_session_id ?? ""}`);
      running.add(s.id);
      return true;
    },
    announce: (s) => {
      calls.push(`push:${s.id}`);
    },
    repoOf: async (dir) => (dir.startsWith(tmp) ? "/repo/.git" : "/other/.git"),
  };
  return f;
}

async function refusal(
  promise: Promise<unknown>
): Promise<{ status: number; reason?: string }> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof mod.SettleRefused, String(error));
    return { status: error.status, reason: error.body.reason };
  }
  assert.fail("expected a refusal");
}

describe("settle", () => {
  test("ends tmux, keeps the row and the worktree, remembers the chat", async () => {
    const f = fake();
    addSession("a", { worktree_path: worktree });
    f.running.add("a");
    const s = await mod.createSettle(f.deps).settle(row("a")!, {
      reason: "manual",
    });
    assert.equal(s.settled_at, 1_700_000_000_000);
    assert.equal(s.settled_reason, "manual");
    assert.equal(s.worktree_path, worktree);
    assert.equal(s.claude_session_id, "11111111-2222-3333-4444-555555555555");
    assert.ok(fs.existsSync(worktree));
    assert.deepEqual(f.calls, ["remember:a", "kill:a"]);
    assert.ok(types.isSettled(row("a")));
  });

  test("a Codex session keeps its terminal history instead", async () => {
    const f = fake();
    addSession("c", { agent_type: "codex" });
    f.running.add("c");
    await mod.createSettle(f.deps).settle(row("c")!, { reason: "manual" });
    assert.deepEqual(f.calls, ["history:c", "kill:c"]);
  });

  test("busy is refused; force cancels the queue", async () => {
    const f = fake();
    const settle = mod.createSettle(f.deps);
    addSession("b");
    f.running.add("b");
    f.status.set("b", "running");
    assert.deepEqual(
      await refusal(settle.settle(row("b")!, { reason: "manual" })),
      {
        status: 409,
        reason: "busy",
      }
    );
    f.status.set("b", "idle");
    queue.queueStore(db.getDb()).enqueue("b", { text: "next", origin: "user" });
    assert.equal(
      (await refusal(settle.settle(row("b")!, { reason: "manual" }))).reason,
      "busy"
    );
    assert.equal(row("b")!.settled_at, null);
    assert.deepEqual(f.calls, []);

    await settle.settle(row("b")!, { reason: "manual", force: true });
    assert.equal(queue.queueStore(db.getDb()).listQueue("b").length, 0);
    assert.ok(row("b")!.settled_at);
  });

  test("already settled and paused are refused", async () => {
    const f = fake();
    const settle = mod.createSettle(f.deps);
    addSession("s", { settled_at: 5, settled_reason: "manual" });
    addSession("p", { paused_at: 5 });
    assert.equal(
      (await refusal(settle.settle(row("s")!, { reason: "manual" }))).reason,
      "already_settled"
    );
    assert.equal(
      (await refusal(settle.settle(row("p")!, { reason: "manual" }))).reason,
      "paused"
    );
  });

  test("only an automatic settle pushes", async () => {
    const f = fake();
    const settle = mod.createSettle(f.deps);
    addSession("m");
    addSession("auto", { pr_number: 106, pr_status: "merged" });
    await settle.settle(row("m")!, { reason: "manual" });
    await settle.settle(row("auto")!, { reason: "pr_merged" });
    assert.deepEqual(f.calls, ["push:auto"]);
    assert.equal(row("auto")!.settled_reason, "pr_merged");
  });

  test("tmux already gone: settles without a kill", async () => {
    const f = fake();
    addSession("g");
    await mod.createSettle(f.deps).settle(row("g")!, { reason: "manual" });
    assert.deepEqual(f.calls, []);
    assert.ok(row("g")!.settled_at);
  });
});

describe("unsettle", () => {
  test("clears settled_at, marks it unsettled and resumes", async () => {
    const f = fake();
    addSession("u", {
      settled_at: 5,
      settled_reason: "pr_merged",
      claude_session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      worktree_path: worktree,
    });
    const result = await mod.createSettle(f.deps).unsettle(row("u")!);
    assert.equal(result.relaunched, true);
    assert.equal(result.session.settled_at, null);
    assert.equal(result.session.settled_reason, types.UNSETTLED_REASON);
    assert.equal(result.session.worktree_path, worktree);
    assert.deepEqual(f.calls, [
      "launch:u:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]);
  });

  test("not settled is refused", async () => {
    const f = fake();
    addSession("n");
    assert.deepEqual(
      await refusal(mod.createSettle(f.deps).unsettle(row("n")!)),
      {
        status: 409,
        reason: "not_settled",
      }
    );
  });

  test("a failed relaunch still leaves it unsettled", async () => {
    const f = fake();
    f.launchFails = true;
    addSession("x", {
      settled_at: 5,
      settled_reason: "manual",
      claude_session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    const result = await mod.createSettle(f.deps).unsettle(row("x")!);
    assert.equal(result.relaunched, false);
    assert.equal(row("x")!.settled_at, null);
  });

  test("no blank Claude: without a conversation it isn't relaunched", async () => {
    const f = fake();
    addSession("y", { settled_at: 5, settled_reason: "manual" });
    const result = await mod.createSettle(f.deps).unsettle(row("y")!);
    assert.equal(result.relaunched, false);
    assert.deepEqual(f.calls, []);
  });

  test("settle, undo, settle again keeps each reason", async () => {
    const f = fake();
    const s = mod.createSettle(f.deps);
    addSession("r", {
      claude_session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    await s.settle(row("r")!, { reason: "pr_merged" });
    assert.equal(row("r")!.settled_reason, "pr_merged");
    await s.unsettle(row("r")!);
    assert.equal(row("r")!.settled_reason, "unsettled");
    f.running.delete("r");
    await s.settle(row("r")!, { reason: "manual" });
    assert.equal(row("r")!.settled_reason, "manual");
  });
});

describe("settlePrOwner", () => {
  test("settles the busy owner in the same repo, not another repo's #N", async () => {
    const f = fake();
    addSession("other", { pr_number: 7, working_directory: "/elsewhere" });
    addSession("owner", { pr_number: 7, worktree_path: worktree });
    addSession("done", { pr_number: 7, settled_at: 5 });
    f.running.add("owner");
    f.status.set("owner", "running");
    const settled = await mod
      .createSettle(f.deps)
      .settlePrOwner(path.join(tmp, "main"), 7);
    assert.equal(settled?.id, "owner");
    assert.equal(settled?.settled_reason, "pr_merged_here");
    assert.equal(settled?.pr_status, "merged");
    assert.equal(settled?.pr_merged_at, 1_700_000_000_000);
    assert.equal(row("other")!.settled_at, null);
    // Merged here: no push, the user just did it
    assert.deepEqual(f.calls, ["remember:owner", "kill:owner"]);
  });

  test("null when no session has the PR", async () => {
    const f = fake();
    addSession("a", { pr_number: 3 });
    assert.equal(await mod.createSettle(f.deps).settlePrOwner(tmp, 4), null);
  });
});

describe("GET ?settled= filter", () => {
  test("parses only 0, 1 and today", () => {
    assert.equal(types.parseSettledFilter("0"), "0");
    assert.equal(types.parseSettledFilter("1"), "1");
    assert.equal(types.parseSettledFilter("today"), "today");
    assert.equal(types.parseSettledFilter(null), null);
    assert.equal(types.parseSettledFilter("yes"), null);
  });

  test("filters the list", () => {
    const now = new Date(2026, 9, 29, 15).getTime();
    const yesterday = new Date(2026, 9, 28, 15).getTime();
    const list = [
      { id: "live", settled_at: null },
      { id: "today", settled_at: now - 60_000 },
      { id: "old", settled_at: yesterday },
    ];
    const ids = (filter: "0" | "1" | "today" | null) =>
      mod.filterSettled(list, filter, now).map((s) => s.id);
    assert.deepEqual(ids(null), ["live", "today", "old"]);
    assert.deepEqual(ids("0"), ["live"]);
    assert.deepEqual(ids("1"), ["today", "old"]);
    assert.deepEqual(ids("today"), ["today"]);
  });
});
