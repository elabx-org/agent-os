import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WatchEdge } from "../../lib/session-watch";
import type { LimitWatchDeps } from "../../lib/limits/watch";
import type { LimitStore } from "../../lib/limits/store";
import type { UsageResponse } from "../../lib/claude-usage";
import type { ClaudeStatus } from "../../lib/claude-state";
import type { Session } from "../../lib/db";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-limits-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
process.env.TZ = "UTC";

let watch: typeof import("../../lib/limits/watch");
let db: typeof import("../../lib/db");
let store: LimitStore;

before(async () => {
  watch = await import("../../lib/limits/watch");
  db = await import("../../lib/db");
  const { limitStore } = await import("../../lib/limits/store");
  const log = console.log;
  console.log = () => {};
  try {
    store = limitStore(db.getDb());
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const screen = (name: string) =>
  fs
    .readFileSync(path.join(__dirname, "fixtures", "limits", name), "utf8")
    .replace(/\n$/, "")
    .split("\n");

// Thu 29 Oct 2026, 1:00 pm UTC
const NOW = Date.UTC(2026, 9, 29, 13, 0);
const RESET = Date.UTC(2026, 9, 29, 15, 40);

function addSession(id: string, agentType = "claude") {
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, agent_type)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, `Signing ${id}`, `claude-${id}`, agentType);
}

const row = (id: string) =>
  db.getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session;

beforeEach(() => {
  db.getDb().exec("DELETE FROM sessions");
  addSession("s1");
});

interface World {
  screen: string[] | null;
  status: ClaudeStatus | null;
  notification: { message: string | null; at: number } | null;
  usage: UsageResponse | null;
  sent: { kind: string; title: string; body: string; event: string }[];
  now: number;
}

function deps(world: World): LimitWatchDeps {
  return {
    session: (id) => row(id),
    title: (s) => s.name,
    screen: async () => world.screen,
    claude: () => ({ status: world.status, notification: world.notification }),
    usage: () => world.usage,
    store,
    notify: (m, event) =>
      world.sent.push({ kind: m.kind, title: m.title, body: m.body, event }),
    now: () => world.now,
  };
}

function world(extra: Partial<World> = {}): World {
  return {
    screen: null,
    status: null,
    notification: null,
    usage: null,
    sent: [],
    now: NOW,
    ...extra,
  };
}

const edge = (
  from: WatchEdge["from"],
  to: WatchEdge["to"],
  sessionId = "s1"
): WatchEdge => ({
  tmuxName: `claude-${sessionId}`,
  sessionId,
  from,
  to,
  workedMs: 30_000,
  at: NOW,
});

const status = (rate: ClaudeStatus["rate_limits"]): ClaudeStatus => ({
  model: null,
  context_window: null,
  cost: null,
  rate_limits: rate,
  effort: null,
  fast_mode: null,
  vim: null,
  session_name: null,
  line: null,
});

const usage = (fiveHour: number, resets: string): UsageResponse => ({
  five_hour: { utilization: fiveHour, resets_at: resets },
  seven_day: { utilization: 61, resets_at: "2026-11-02T18:00:00Z" },
  seven_day_sonnet: null,
  seven_day_opus: null,
  extra_usage: {
    is_enabled: false,
    utilization: null,
    used_credits: null,
    monthly_limit: null,
  },
  plan: "Max 5x",
});

describe("handleLimitEdge", () => {
  test("a limit screen at the end of a turn marks and pushes", async () => {
    const w = world({ screen: screen("session-limit.txt") });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    const s = row("s1");
    assert.equal(s.limited_at, NOW);
    assert.equal(s.limited_until, RESET);
    assert.equal(s.limit_kind, "session");
    assert.deepEqual(w.sent, [
      {
        kind: "limited",
        title: "Limited · Signing s1",
        body: "Claude hit the session limit · resets 3:40 pm",
        event: "limited",
      },
    ]);
  });

  test("the same limit again is not marked or pushed twice", async () => {
    const w = world({ screen: screen("session-limit.txt") });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    w.now = NOW + 60_000;
    await watch.handleLimitEdge(edge("running", "waiting"), deps(w));
    assert.equal(row("s1").limited_at, NOW);
    assert.equal(w.sent.length, 1);
  });

  test("the status line beats the screen for the reset", async () => {
    const statusReset = Date.UTC(2026, 9, 29, 15, 41);
    const w = world({
      screen: screen("session-limit.txt"),
      status: status({
        five_hour: { used_percentage: 100, resets_at: statusReset / 1000 },
      }),
      usage: usage(100, "2026-10-29T15:42:00Z"),
    });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    assert.equal(row("s1").limited_until, statusReset);
  });

  test("the usage API beats the screen and names an unknown kind", async () => {
    const w = world({
      screen: screen("fake-limit.txt"),
      usage: usage(100, "2026-10-29T15:42:00Z"),
    });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    const s = row("s1");
    assert.equal(s.limit_kind, "session");
    assert.equal(s.limited_until, Date.UTC(2026, 9, 29, 15, 42));
  });

  test("a full status window alone marks it", async () => {
    const w = world({
      screen: screen("approaching.txt"),
      status: status({
        seven_day: { used_percentage: 100, resets_at: 1_793_642_400 },
      }),
    });
    await watch.handleLimitEdge(edge("running", "waiting"), deps(w));
    const s = row("s1");
    assert.equal(s.limit_kind, "week");
    assert.equal(s.limited_until, 1_793_642_400_000);
    assert.equal(w.sent[0].body, "Claude hit the weekly limit · resets Monday");
  });

  test("a full status window that already reset is ignored", async () => {
    const w = world({
      status: status({
        five_hour: { used_percentage: 100, resets_at: NOW / 1000 - 60 },
      }),
    });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    assert.equal(row("s1").limited_at, null);
    assert.equal(w.sent.length, 0);
  });

  test("this turn's hook notification counts, an old one doesn't", async () => {
    const message = "You've hit your session limit · resets 3:40pm (UTC)";
    const old = world({ notification: { message, at: NOW - 120_000 } });
    await watch.handleLimitEdge(edge("running", "idle"), deps(old));
    assert.equal(row("s1").limited_at, null);
    const fresh = world({ notification: { message, at: NOW - 1_000 } });
    await watch.handleLimitEdge(edge("running", "idle"), deps(fresh));
    assert.equal(row("s1").limited_until, RESET);
  });

  test("no limit on screen, other agents and other edges do nothing", async () => {
    addSession("x1", "codex");
    const w = world({ screen: screen("stale.txt") });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    w.screen = screen("session-limit.txt");
    await watch.handleLimitEdge(edge("running", "idle", "x1"), deps(w));
    await watch.handleLimitEdge(edge("idle", "waiting"), deps(w));
    await watch.handleLimitEdge(edge("running", "gone"), deps(w));
    await watch.handleLimitEdge(edge("running", "idle", "nope"), deps(w));
    assert.equal(row("s1").limited_at, null);
    assert.equal(row("x1").limited_at, null);
    assert.equal(w.sent.length, 0);
  });

  test("an unknown reset is learnt on a later turn end", async () => {
    const w = world({ screen: ["You've hit your session limit"] });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    assert.equal(row("s1").limited_until, null);
    assert.equal(w.sent[0].body, "Claude hit the session limit");
    w.screen = screen("session-limit.txt");
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    assert.equal(row("s1").limited_until, RESET);
    assert.equal(w.sent.length, 1);
  });

  test("working again clears it; resumed at the reset pushes resumed", async () => {
    const w = world({ screen: screen("session-limit.txt") });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    store.setPolicy("s1", "at_reset", "continue");
    await watch.handleLimitEdge(edge("idle", "running"), deps(w));
    const s = row("s1");
    assert.equal(s.limited_at, null);
    assert.equal(s.resume_policy, null);
    assert.deepEqual(w.sent[1], {
      kind: "resumed",
      title: "Resumed · Signing s1",
      body: "Resumed after the session limit",
      event: "resumed",
    });
  });

  test("working again without at_reset clears quietly", async () => {
    const w = world({ screen: screen("session-limit.txt") });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    store.setPolicy("s1", "snooze", null);
    await watch.handleLimitEdge(edge("waiting", "running"), deps(w));
    assert.equal(row("s1").limited_at, null);
    assert.equal(w.sent.length, 1);
    // Not limited: nothing to clear, nothing sent
    await watch.handleLimitEdge(edge("idle", "running"), deps(w));
    assert.equal(w.sent.length, 1);
  });

  test("a new limit after the old one reset marks again", async () => {
    const w = world({ screen: screen("session-limit.txt") });
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    // Past the reset, never cleared (snoozed, nobody typed): a new limit
    w.now = RESET + 60_000;
    await watch.handleLimitEdge(edge("running", "idle"), deps(w));
    const s = row("s1");
    assert.equal(s.limited_at, RESET + 60_000);
    assert.equal(s.limited_until, Date.UTC(2026, 9, 30, 15, 40));
    assert.equal(w.sent.length, 2);
  });
});

describe("fillUntil", () => {
  test("takes the reset from the usage figures, asking once when missing", async () => {
    addSession("s2");
    store.markLimited("s1", { at: NOW, until: null, kind: "session" });
    store.markLimited("s2", { at: NOW, until: null, kind: "unknown" });
    const w = world();
    let asked = 0;
    const refresh = async () => {
      asked++;
      w.usage = usage(100, "2026-10-29T15:40:00Z");
    };
    assert.equal(await watch.fillUntil(deps(w), refresh), 2);
    assert.equal(asked, 1);
    assert.equal(row("s1").limited_until, RESET);
    assert.equal(row("s2").limited_until, RESET);
    // Nothing waiting: no request
    assert.equal(await watch.fillUntil(deps(w), refresh), 0);
    assert.equal(asked, 1);
  });

  test("a reset already past is not taken", async () => {
    store.markLimited("s1", { at: NOW, until: null, kind: "session" });
    const w = world({ usage: usage(100, "2026-10-29T12:00:00Z") });
    assert.equal(await watch.fillUntil(deps(w), async () => {}), 0);
    assert.equal(row("s1").limited_until, null);
  });
});

test("limitedBody: a reset a day or more away is the weekday", () => {
  assert.equal(
    watch.limitedBody("opus", Date.UTC(2026, 10, 2, 14), NOW),
    "Claude hit the Opus limit · resets Monday"
  );
  assert.equal(
    watch.limitedBody("unknown", null, NOW),
    "Claude hit the usage limit"
  );
});
