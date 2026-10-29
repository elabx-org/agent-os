import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { Readiness } from "../../lib/session-ready";
import type { HoldReason } from "../../lib/queue/types";
import type { Mode } from "../../lib/permission-mode";
import type { WatchEdge } from "../../lib/session-watch";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mode-apply-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let apply: typeof import("../../lib/permission-apply");
let pm: typeof import("../../lib/permission-mode");

before(async () => {
  apply = await import("../../lib/permission-apply");
  pm = await import("../../lib/permission-mode");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const READY: Readiness = { ready: true, holdReason: null };
const hold = (holdReason: HoldReason): Readiness => ({
  ready: false,
  holdReason,
});

let n = 0;
/** A fresh id per test: the applier remembers cycle misses per session */
const session = (over: Partial<Session> = {}) =>
  ({
    id: `s${++n}`,
    agent_type: "claude",
    permission_mode: "auto",
    permission_pending: "auto",
    launch_caps: null,
    ...over,
  }) as Session;

/**
 * Fake deps: scripted readiness, and a Claude footer that moves one step
 * through `cycle` per press (pressed only through cycleToMode, as live)
 */
function fakes(
  opts: {
    reads?: Readiness[];
    cycle?: string[];
    start?: string | null;
    throws?: boolean;
  } = {}
) {
  const reads = [...(opts.reads ?? [])];
  const cycle = opts.cycle ?? ["default", "acceptEdits", "plan", "auto"];
  let at = opts.start === null ? -1 : cycle.indexOf(opts.start ?? "default");
  const log: string[] = [];
  const cleared: [string, Mode][] = [];
  const deps: import("../../lib/permission-apply").ApplyPendingDeps = {
    readiness: async () => {
      log.push("read");
      return reads.length ? reads.shift()! : READY;
    },
    applyModeLive: async (_s, mode) => {
      if (opts.throws) throw new Error("tmux gone");
      return pm.cycleToMode(mode, {
        read: async () => (at < 0 ? null : cycle[at]),
        press: async () => {
          log.push("press");
          at = (at + 1) % cycle.length;
        },
      });
    },
    clearPending: (id, mode) => cleared.push([id, mode]),
    sleep: async () => {},
  };
  return { deps, log, cleared, footer: () => (at < 0 ? null : cycle[at]) };
}

const presses = (log: string[]) => log.filter((e) => e === "press").length;

describe("applyPendingMode", () => {
  test("nothing pending: no reads, no keys", async () => {
    const f = fakes();
    const r = await apply.applyPendingMode(
      session({ permission_pending: null }),
      f.deps
    );
    assert.deepEqual(r, { mode: null, applied: false, reason: "none" });
    assert.deepEqual(f.log, []);
  });

  test("not Claude: left for the restart, no keys", async () => {
    for (const agent_type of ["codex", "gemini", "shell"] as const) {
      const f = fakes();
      const r = await apply.applyPendingMode(session({ agent_type }), f.deps);
      assert.equal(r.reason, "not_claude");
      assert.deepEqual(f.log, []);
    }
  });

  test("idle: presses through the cycle and clears the pending mode", async () => {
    const f = fakes();
    const s = session({ permission_pending: "auto" });
    const r = await apply.applyPendingMode(s, f.deps);
    assert.deepEqual(r, { mode: "auto", applied: true });
    assert.equal(f.footer(), "auto");
    assert.deepEqual(f.cleared, [[s.id, "auto"]]);
    // Two readiness reads before the first key
    assert.deepEqual(f.log.slice(0, 2), ["read", "read"]);
    assert.equal(presses(f.log), 3);
  });

  test("busy, asking or a prompt: never a key", async () => {
    for (const reason of ["busy", "asking", "permission", "typing"] as const) {
      for (const reads of [[hold(reason)], [READY, hold(reason)]]) {
        const f = fakes({ reads });
        const r = await apply.applyPendingMode(session(), f.deps);
        assert.equal(r.reason, "not_ready", reason);
        assert.equal(presses(f.log), 0);
        assert.deepEqual(f.cleared, []);
      }
    }
  });

  test("a readiness read that throws fails closed", async () => {
    const f = fakes();
    f.deps.readiness = async () => {
      throw new Error("tmux");
    };
    const r = await apply.applyPendingMode(session(), f.deps);
    assert.equal(r.reason, "not_ready");
    assert.equal(presses(f.log), 0);
  });

  test("bounded presses; a mode not in the cycle stays pending", async () => {
    // An older Claude without "auto": round the cycle once and stop
    const f = fakes({ cycle: ["default", "acceptEdits", "plan"] });
    const s = session({ permission_pending: "auto" });
    const r = await apply.applyPendingMode(s, f.deps);
    assert.deepEqual(r, {
      mode: "auto",
      applied: false,
      reason: "not_in_cycle",
    });
    assert.ok(presses(f.log) <= 6);
    assert.equal(f.footer(), "default", "back where it started");
    assert.deepEqual(f.cleared, []);

    // Not tried again (no more cycling on every edge) until a new pick
    const again = fakes({ cycle: ["default", "acceptEdits", "plan"] });
    const r2 = await apply.applyPendingMode(s, again.deps);
    assert.equal(r2.reason, "not_in_cycle");
    assert.deepEqual(again.log, []);

    apply.forgetModeMiss(s.id);
    const third = fakes({ cycle: ["default", "acceptEdits", "plan"] });
    await apply.applyPendingMode(s, third.deps);
    assert.ok(presses(third.log) > 0);
  });

  test("never more than 6 presses even if the footer never matches", async () => {
    const cycle = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const f = fakes({ cycle, start: "m0" });
    const r = await apply.applyPendingMode(session(), f.deps);
    assert.equal(r.applied, false);
    assert.equal(presses(f.log), 6);
  });

  test("full access is never cycled in without the Labs cap", async () => {
    const f = fakes({
      cycle: ["default", "acceptEdits", "plan", "bypassPermissions"],
    });
    const r = await apply.applyPendingMode(
      session({ permission_pending: "bypassPermissions", launch_caps: null }),
      f.deps
    );
    assert.equal(r.reason, "not_in_cycle");
    assert.deepEqual(f.log, []);
    const malformed = await apply.applyPendingMode(
      session({ permission_pending: "bypassPermissions", launch_caps: "{" }),
      f.deps
    );
    assert.equal(malformed.reason, "not_in_cycle");
    assert.deepEqual(f.log, []);
  });

  test("full access with the cap goes through the cycle", async () => {
    const f = fakes({
      cycle: ["default", "acceptEdits", "plan", "bypassPermissions"],
    });
    const r = await apply.applyPendingMode(
      session({
        permission_pending: "bypassPermissions",
        launch_caps: JSON.stringify({ allowBypassCycle: true }),
      }),
      f.deps
    );
    assert.equal(r.applied, true);
    assert.equal(f.footer(), "bypassPermissions");
  });

  test("an unreadable footer (a dialog) is a failure, tried again later", async () => {
    const s = session();
    const f = fakes({ start: null });
    const r = await apply.applyPendingMode(s, f.deps);
    assert.equal(r.reason, "failed");
    assert.equal(presses(f.log), 0);
    const later = fakes();
    assert.equal((await apply.applyPendingMode(s, later.deps)).applied, true);
  });

  test("a throwing press is a failure that keeps the pending mode", async () => {
    const f = fakes({ throws: true });
    const r = await apply.applyPendingMode(session(), f.deps);
    assert.equal(r.reason, "failed");
    assert.deepEqual(f.cleared, []);
  });
});

describe("decideApply", () => {
  const base = {
    agentType: "claude",
    running: true,
    ready: true,
    mode: "auto" as Mode,
    flagOn: true,
    canCycleBypass: false,
  };
  const table: [Partial<typeof base>, string, string][] = [
    // Not running: stored, at the next launch, whatever the agent
    [{ running: false }, "store", "nextLaunch"],
    [{ running: false, agentType: "codex" }, "store", "nextLaunch"],
    [{ running: false, mode: "bypassPermissions" }, "store", "nextLaunch"],
    // Codex, Gemini and the rest restart
    [{ agentType: "codex" }, "store", "restart"],
    [{ agentType: "gemini", ready: false }, "store", "restart"],
    [{ agentType: "codex", flagOn: false }, "store", "restart"],
    // Claude idle: now
    [{}, "live", "now"],
    [{ flagOn: false }, "live", "now"],
    // Claude mid-turn: flag on waits for the idle edge, off is today's
    [{ ready: false }, "pending", "nextTurn"],
    [{ ready: false, flagOn: false }, "live", "now"],
    // Full access without the cap: only a restart, never a cycle
    [{ mode: "bypassPermissions" }, "pending", "restart"],
    [{ mode: "bypassPermissions", ready: false }, "pending", "restart"],
    [{ mode: "bypassPermissions", flagOn: false }, "pending", "restart"],
    // With the cap it is like any other mode
    [{ mode: "bypassPermissions", canCycleBypass: true }, "live", "now"],
    [
      { mode: "bypassPermissions", canCycleBypass: true, ready: false },
      "pending",
      "nextTurn",
    ],
  ];
  for (const [over, action, appliesAt] of table) {
    test(`${JSON.stringify(over)} -> ${action}/${appliesAt}`, () => {
      assert.deepEqual(apply.decideApply({ ...base, ...over }), {
        action,
        appliesAt,
      });
    });
  }
});

describe("modeEdgeHandler", () => {
  const edge = (to: WatchEdge["to"], from: WatchEdge["from"] = "running") =>
    ({
      tmuxName: "claude-x",
      sessionId: "x",
      from,
      to,
      workedMs: 0,
      at: 0,
    }) as WatchEdge;

  function handler(
    opts: { flag?: boolean; session?: Partial<Session> | null } = {}
  ) {
    const applied: string[] = [];
    const h = apply.modeEdgeHandler({
      flagOn: () => opts.flag ?? true,
      getSession: (id) =>
        opts.session === null
          ? null
          : session({ id, permission_pending: "auto", ...opts.session }),
      apply: async (id) => applied.push(id),
    });
    return { h, applied };
  }

  let h: ReturnType<typeof handler>;
  beforeEach(() => {
    h = handler();
  });

  test("idle and waiting edges apply a pending mode", () => {
    h.h(edge("idle"));
    h.h(edge("waiting"));
    h.h(edge("idle", "waiting"));
    assert.deepEqual(h.applied, ["x", "x", "x"]);
  });

  test("never on a turn's start or a gone session", () => {
    h.h(edge("running", "idle"));
    h.h(edge("gone"));
    h.h(edge("dead"));
    assert.deepEqual(h.applied, []);
  });

  test("flag off, nothing pending, unknown or not Claude: nothing", () => {
    for (const opts of [
      { flag: false },
      { session: { permission_pending: null } },
      { session: null },
      { session: { agent_type: "codex" as const } },
    ]) {
      const x = handler(opts);
      x.h(edge("idle"));
      assert.deepEqual(x.applied, [], JSON.stringify(opts));
    }
  });
});
