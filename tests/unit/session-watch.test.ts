import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionStatus } from "../../lib/status-detector";
import type { WatchEdge } from "../../lib/session-watch";

// lib/db reads DB_PATH when it loads (the push watcher imports it)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-watch-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let watch: typeof import("../../lib/session-watch");
let push: typeof import("../../lib/push/watcher");

before(async () => {
  watch = await import("../../lib/session-watch");
  push = await import("../../lib/push/watcher");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Recorded {
  names: Record<string, string>;
  polls: { t: number; s: Record<string, SessionStatus>; prompt: string[] }[];
}

const recorded: Recorded = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "watch-sequences.json"),
    "utf8"
  )
);

type Announce = { t: number; tmuxName: string; kind: string };

const MIN_WORK_MS = 20_000;

/** lib/push/watcher.ts poll() before the extraction, minus the I/O */
function oldWatcher(rec: Recorded): Announce[] {
  const tracks = new Map<
    string,
    {
      stable: SessionStatus;
      candidate: SessionStatus;
      runningSince: number | null;
    }
  >();
  const out: Announce[] = [];
  for (const { t, s, prompt } of rec.polls) {
    const seen = new Set<string>();
    for (const [key, status] of Object.entries(s)) {
      const tmuxName = rec.names[key];
      seen.add(tmuxName);
      const track = tracks.get(tmuxName);
      if (!track) {
        tracks.set(tmuxName, {
          stable: status,
          candidate: status,
          runningSince: status === "running" ? t : null,
        });
        continue;
      }
      if (status !== track.candidate) {
        track.candidate = status;
        continue;
      }
      if (status === track.stable) continue;
      const before = track.stable;
      const workedMs = track.runningSince ? t - track.runningSince : 0;
      track.stable = status;
      track.runningSince = status === "running" ? t : null;
      if (status !== "waiting") continue;
      const kind = prompt.includes(key) ? "needsYou" : "finished";
      if (
        kind === "finished" &&
        (before !== "running" || workedMs < MIN_WORK_MS)
      )
        continue;
      out.push({ t, tmuxName, kind });
    }
    for (const name of tracks.keys()) {
      if (!seen.has(name)) tracks.delete(name);
    }
  }
  return out;
}

/** The extracted tracker fed the same polls; the push watcher's rule on top */
async function newWatcher(rec: Recorded) {
  const tracker = new watch.WatchTracker();
  const edges: WatchEdge[] = [];
  const out: Announce[] = [];
  const byName = Object.fromEntries(
    Object.entries(rec.names).map(([k, v]) => [v, k])
  );
  for (const { t, s, prompt } of rec.polls) {
    const reader = {
      list: async () => Object.keys(s).map((k) => rec.names[k]),
      status: async (name: string) => s[byName[name]],
    };
    await watch.pollOnce(
      tracker,
      reader,
      (e) => edges.push(e),
      () => t
    );
    for (const e of edges.filter((e) => e.at === t)) {
      const kind = push.edgeKind(e, prompt.includes(byName[e.tmuxName]));
      if (kind) out.push({ t, tmuxName: e.tmuxName, kind });
    }
  }
  return { tracker, edges, out };
}

describe("session watch: extracted from the push watcher", () => {
  test("announces exactly what the old poll did", async () => {
    const before = oldWatcher(recorded);
    const { out } = await newWatcher(recorded);
    assert.deepEqual(out, before);
    // The recording covers each rule
    const kinds = before.map((a) => `${a.tmuxName.split("-")[0]}:${a.kind}`);
    assert.deepEqual(kinds, [
      "claude:finished",
      "codex:needsYou",
      "claude:needsYou",
    ]);
  });

  test("edges carry from, to and how long it worked", async () => {
    const { edges } = await newWatcher(recorded);
    const a = recorded.names.A;
    const finished = edges.find((e) => e.tmuxName === a && e.to === "waiting");
    assert.ok(finished);
    assert.equal(finished.from, "running");
    assert.equal(finished.workedMs, 33_000);
    assert.equal(finished.sessionId, "11111111-1111-4111-8111-111111111111");
    // Flapping never reaches a stable change
    const b = recorded.names.B;
    assert.ok(!edges.some((e) => e.tmuxName === b && e.at < 12_000));
  });

  test("a vanished session is gone; back again it only learns", async () => {
    const { edges } = await newWatcher(recorded);
    const c = recorded.names.C;
    const gone = edges.filter((e) => e.tmuxName === c && e.to === "gone");
    assert.equal(gone.length, 1);
    assert.equal(gone[0].from, "idle");
    const after = edges.filter((e) => e.tmuxName === c && e.at > gone[0].at);
    // running (learned), then waiting after two reads
    assert.deepEqual(
      after.map((e) => [e.from, e.to]),
      [["running", "waiting"]]
    );
  });

  test("latest is the stable status and since when", async () => {
    const { tracker } = await newWatcher(recorded);
    const last = recorded.polls[recorded.polls.length - 1].t;
    assert.deepEqual(tracker.latest("11111111-1111-4111-8111-111111111111"), {
      status: "dead",
      since: last,
    });
    assert.equal(tracker.latest("nope"), null);
  });

  test("onEdge subscribers can unsubscribe", () => {
    const seen: string[] = [];
    const off = watch.onEdge((e) => seen.push(e.tmuxName));
    off();
    assert.equal(seen.length, 0);
  });

  test("nothing polls when tickers are disabled", () => {
    process.env.AGENTOS_DISABLE_TICKERS = "1";
    try {
      watch.startSessionWatch();
      const shared = globalThis as { __agentosWatch?: { started: boolean } };
      assert.equal(shared.__agentosWatch?.started, false);
    } finally {
      delete process.env.AGENTOS_DISABLE_TICKERS;
    }
  });
});

describe("session watch: performance budget (plan 0.5)", () => {
  test("a poll of 20 sessions takes < 50ms CPU", async () => {
    const names = Array.from(
      { length: 20 },
      (_, i) =>
        `claude-${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`
    );
    const tracker = new watch.WatchTracker();
    const statuses: SessionStatus[] = ["running", "running", "waiting", "idle"];
    let tick = 0;
    const reader = {
      list: async () => names,
      status: async (name: string) =>
        statuses[(tick + names.indexOf(name)) % statuses.length],
    };
    let worst = 0;
    for (; tick < 50; tick++) {
      const start = process.cpuUsage();
      await watch.pollOnce(
        tracker,
        reader,
        (e) => push.edgeKind(e, false),
        () => tick * 3000
      );
      const used = process.cpuUsage(start);
      worst = Math.max(worst, (used.user + used.system) / 1000);
    }
    assert.ok(worst < 50, `worst tick ${worst.toFixed(2)}ms`);
  });
});
