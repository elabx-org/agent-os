import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { PolledPR, PrPollDeps } from "../../lib/pr-poller";
import type { AutoSettleDeps } from "../../lib/auto-settle";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-prpoll-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let poller: typeof import("../../lib/pr-poller");
let auto: typeof import("../../lib/auto-settle");

before(async () => {
  db = await import("../../lib/db");
  poller = await import("../../lib/pr-poller");
  auto = await import("../../lib/auto-settle");
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

const raw = () => db.getDb();
const row = (id: string) =>
  db.queries.getSession(raw()).get(id) as Session | undefined;

function addSession(
  id: string,
  branch: string | null,
  worktree: string | null,
  createdAt = "2026-10-01 10:00:00"
) {
  raw()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, agent_type, branch_name,
         worktree_path, working_directory, created_at, updated_at)
       VALUES (?, ?, ?, 'claude', ?, ?, '/repos/a', ?, '2026-10-01 10:00:00')`
    )
    .run(id, id, `claude-${id}`, branch, worktree, createdAt);
}

beforeEach(() => {
  raw().exec("DELETE FROM sessions");
});

const pr = (
  number: number,
  head: string,
  state: string,
  extra: Partial<PolledPR> = {}
): PolledPR => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  state,
  title: `PR ${number}`,
  headRefName: head,
  createdAt: "2026-10-10T10:00:00Z",
  statusCheckRollup: [],
  ...extra,
});

function fakeDeps(
  prsByDir: Record<string, PolledPR[]>,
  patch: Partial<PrPollDeps> = {}
) {
  const calls: string[] = [];
  let autoRuns = 0;
  const deps: PrPollDeps = {
    db: raw(),
    prPollerOn: () => true,
    autoSettleOn: () => false,
    ghReady: async () => true,
    // /repos/a and its worktrees /wt/a-* share one common dir
    repoKey: async (dir) =>
      dir.startsWith("/wt/a-") || dir === "/repos/a"
        ? "/repos/a/.git"
        : dir.startsWith("/repos/")
          ? `${dir}/.git`
          : null,
    listPrs: async (dir) => {
      calls.push(dir);
      const key = dir.startsWith("/wt/a-") ? "/repos/a" : dir;
      return prsByDir[key] ?? [];
    },
    autoSettle: async () => {
      autoRuns++;
      return 0;
    },
    ...patch,
  };
  return { deps, calls, autoRuns: () => autoRuns };
}

describe("matchPr", () => {
  const session = { branch_name: "feat/x", created_at: "2026-10-01 10:00:00" };

  test("picks the branch's PR, an open one first", () => {
    const got = poller.matchPr(
      [
        pr(5, "feat/y", "OPEN"),
        pr(6, "feat/x", "MERGED", { mergedAt: "2026-10-05T10:00:00Z" }),
        pr(7, "feat/x", "OPEN"),
      ],
      session
    );
    assert.equal(got?.pr_number, 7);
    assert.equal(got?.pr_status, "open");
    assert.equal(got?.pr_merged_at, null);
  });

  test("a merged PR carries its merge time", () => {
    const got = poller.matchPr(
      [pr(6, "feat/x", "MERGED", { mergedAt: "2026-10-05T10:00:00Z" })],
      session
    );
    assert.equal(got?.pr_status, "merged");
    assert.equal(got?.pr_merged_at, Date.parse("2026-10-05T10:00:00Z"));
    assert.equal(got?.pr_title, "PR 6");
  });

  test("fork PRs and PRs merged before the session don't count", () => {
    assert.equal(
      poller.matchPr(
        [pr(8, "feat/x", "OPEN", { isCrossRepository: true })],
        session
      ),
      null
    );
    assert.equal(
      poller.matchPr(
        [pr(9, "feat/x", "MERGED", { mergedAt: "2026-09-01T10:00:00Z" })],
        session
      ),
      null
    );
    assert.equal(
      poller.matchPr([pr(9, "feat/x", "OPEN")], {
        branch_name: null,
        created_at: "",
      }),
      null
    );
  });

  test("checks fold: failure wins, running is pending, else passed", () => {
    const checks = (rollup: PolledPR["statusCheckRollup"]) =>
      poller.matchPr(
        [pr(1, "feat/x", "OPEN", { statusCheckRollup: rollup })],
        session
      )?.pr_checks;
    assert.equal(checks([]), null);
    assert.equal(
      checks([
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "StatusContext", state: "SUCCESS" },
      ]),
      "passed"
    );
    assert.equal(
      checks([
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
      ]),
      "pending"
    );
    assert.equal(
      checks([
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
        { __typename: "StatusContext", state: "FAILURE" },
      ]),
      "failed"
    );
  });
});

describe("sessionRepoDir", () => {
  test("worktree, else its folder, else the project's", () => {
    assert.equal(
      poller.sessionRepoDir(
        { worktree_path: "/wt/a-1", working_directory: "/repos/a" },
        null
      ),
      "/wt/a-1"
    );
    assert.equal(
      poller.sessionRepoDir(
        { worktree_path: null, working_directory: "~" },
        { working_directory: "/repos/p" }
      ),
      "/repos/p"
    );
    assert.equal(
      poller.sessionRepoDir(
        { worktree_path: null, working_directory: "~/x" },
        null
      ),
      path.join(os.homedir(), "x")
    );
  });
});

describe("pollPrsOnce", () => {
  test("one gh call per repo, shared by its worktrees; writes the pr_* columns", async () => {
    addSession("a1", "feat/one", "/wt/a-1");
    addSession("a2", "feat/two", "/wt/a-2");
    addSession("a3", "feat/three", null);
    raw()
      .prepare(
        "UPDATE sessions SET working_directory = '/repos/b' WHERE id = 'a3'"
      )
      .run();
    addSession("nobranch", null, "/wt/a-3");
    const { deps, calls } = fakeDeps({
      "/repos/a": [
        pr(10, "feat/one", "OPEN", {
          statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
        }),
        pr(11, "feat/two", "MERGED", { mergedAt: "2026-10-20T12:00:00Z" }),
      ],
      "/repos/b": [pr(12, "feat/three", "CLOSED")],
    });
    const report = await poller.pollPrsOnce(deps);
    assert.equal(calls.length, 2);
    assert.equal(report.repos, 2);
    assert.equal(report.updated, 3);
    assert.deepEqual(report.merged, ["a2"]);

    const a1 = row("a1")!;
    assert.equal(a1.pr_number, 10);
    assert.equal(a1.pr_status, "open");
    assert.equal(a1.pr_checks, "passed");
    assert.equal(a1.pr_title, "PR 10");
    assert.equal(a1.pr_url, "https://github.com/o/r/pull/10");
    // The lists don't reorder
    assert.equal(a1.updated_at, "2026-10-01 10:00:00");
    assert.equal(row("a2")!.pr_merged_at, Date.parse("2026-10-20T12:00:00Z"));
    assert.equal(row("a3")!.pr_status, "closed");
    assert.equal(row("nobranch")!.pr_number, null);

    // Unchanged: no write, and a merge is reported once
    const again = await poller.pollPrsOnce(deps);
    assert.equal(again.updated, 0);
    assert.deepEqual(again.merged, []);
  });

  test("a PR missing from gh's list leaves the row alone", async () => {
    addSession("k1", "feat/old", "/wt/a-1");
    raw()
      .prepare(
        "UPDATE sessions SET pr_number = 3, pr_status = 'open' WHERE id = 'k1'"
      )
      .run();
    const { deps } = fakeDeps({ "/repos/a": [] });
    const report = await poller.pollPrsOnce(deps);
    assert.equal(report.updated, 0);
    assert.equal(row("k1")!.pr_number, 3);
  });

  test("settled, paused and non-repo sessions are skipped", async () => {
    addSession("s1", "feat/one", "/wt/a-1");
    addSession("p1", "feat/two", "/wt/a-2");
    addSession("x1", "feat/three", "/elsewhere");
    raw().prepare("UPDATE sessions SET settled_at = 1 WHERE id = 's1'").run();
    raw().prepare("UPDATE sessions SET paused_at = 1 WHERE id = 'p1'").run();
    const { deps, calls } = fakeDeps({
      "/repos/a": [pr(10, "feat/one", "OPEN"), pr(11, "feat/two", "OPEN")],
    });
    const report = await poller.pollPrsOnce(deps);
    assert.equal(calls.length, 0);
    assert.equal(report.updated, 0);
  });

  test("prPoller off, or gh not signed in: nothing runs", async () => {
    addSession("f1", "feat/one", "/wt/a-1");
    const off = fakeDeps(
      { "/repos/a": [pr(10, "feat/one", "MERGED")] },
      { prPollerOn: () => false, autoSettleOn: () => true }
    );
    assert.deepEqual(await poller.pollPrsOnce(off.deps), {
      repos: 0,
      updated: 0,
      merged: [],
    });
    assert.equal(off.calls.length, 0);
    assert.equal(off.autoRuns(), 0);

    const signedOut = fakeDeps(
      { "/repos/a": [pr(10, "feat/one", "MERGED")] },
      { ghReady: async () => false }
    );
    await poller.pollPrsOnce(signedOut.deps);
    assert.equal(signedOut.calls.length, 0);
    assert.equal(row("f1")!.pr_number, null);
  });

  test("auto-settle runs after the pass only while its flag is on", async () => {
    addSession("g1", "feat/one", "/wt/a-1");
    const prs = { "/repos/a": [pr(10, "feat/one", "OPEN")] };
    const off = fakeDeps(prs);
    await poller.pollPrsOnce(off.deps);
    assert.equal(off.autoRuns(), 0);
    const on = fakeDeps(prs, { autoSettleOn: () => true });
    await poller.pollPrsOnce(on.deps);
    assert.equal(on.autoRuns(), 1);
  });

  test("fake gh reports merged: an idle session settles exactly once", async () => {
    addSession("m1", "feat/done", "/wt/a-1");
    // An hour after the merge: recent enough to settle on its own
    const mergedAt = Date.parse("2026-10-20T12:00:00Z");
    const settled: string[] = [];
    const settleDeps: AutoSettleDeps = {
      db: raw(),
      autoSettleOn: () => true,
      status: async () => "idle",
      pendingQueue: () => 0,
      lastInputAt: async () => mergedAt - 60 * 60_000,
      focused: () => false,
      settle: async (session, options) => {
        settled.push(`${session.id}:${options.reason}:${options.force}`);
        raw()
          .prepare(
            "UPDATE sessions SET settled_at = ?, settled_reason = ? WHERE id = ?"
          )
          .run(Date.now(), options.reason, session.id);
        return row(session.id)!;
      },
      now: () => mergedAt + 60 * 60_000,
    };
    const { deps } = fakeDeps(
      {
        "/repos/a": [
          pr(20, "feat/done", "MERGED", { mergedAt: "2026-10-20T12:00:00Z" }),
        ],
      },
      {
        autoSettleOn: () => true,
        autoSettle: () => auto.autoSettlePass(settleDeps),
      }
    );
    await poller.pollPrsOnce(deps);
    await poller.pollPrsOnce(deps);
    assert.deepEqual(settled, ["m1:pr_merged:false"]);
    assert.equal(row("m1")!.settled_reason, "pr_merged");
  });
});
