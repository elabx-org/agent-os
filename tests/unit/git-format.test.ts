import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchCaption,
  changedFiles,
  checksLabel,
  checksTone,
  commitLabel,
  commitTarget,
  isOwnCommit,
  onBaseBranch,
  prBlurb,
  prMetaCaption,
  prStateCaption,
  shortAge,
} from "../../components/GitPanel/git-format";
import type { GitFile } from "../../lib/git-status";
import type { BranchInfo, PRSummary } from "../../lib/git-types";

const info = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  baseBranch: "main",
  aheadOfBase: 0,
  behindBase: 0,
  pushed: true,
  ...over,
});
const up = { ahead: 0, behind: 0 };

test("branch caption: ahead of the base, pushed or not (E-Git)", () => {
  assert.equal(
    branchCaption("fix/x", up, info({ aheadOfBase: 2 })),
    "2 ahead of main · pushed"
  );
  assert.equal(
    branchCaption("fix/x", up, info({ aheadOfBase: 1, pushed: false })),
    "1 ahead of main · not pushed"
  );
});

test("branch caption: behind, both, up to date, never pushed", () => {
  assert.equal(
    branchCaption("fix/x", up, info({ behindBase: 1 })),
    "1 behind main"
  );
  assert.equal(
    branchCaption("fix/x", up, info({ aheadOfBase: 2, behindBase: 3 })),
    "2 ahead, 3 behind main · pushed"
  );
  assert.equal(branchCaption("main", up, info()), "Up to date with main");
  assert.equal(
    branchCaption("main", up, info({ pushed: false })),
    "Up to date with main"
  );
  assert.equal(
    branchCaption("fix/new", up, info({ pushed: false })),
    "Not pushed"
  );
});

test("branch caption without a base: the upstream's counts, else nothing", () => {
  const none = info({ baseBranch: null, pushed: false });
  assert.equal(
    branchCaption("x", { ahead: 2, behind: 1 }, none),
    "2 to push · 1 to pull"
  );
  assert.equal(branchCaption("x", up, none), "");
});

test("checks: label and tone", () => {
  assert.equal(checksLabel("passed"), "Checks passed");
  assert.equal(checksLabel("failed"), "Checks failed");
  assert.equal(checksLabel("pending"), "Checks running");
  assert.equal(checksLabel(null), "No checks");
  assert.equal(checksTone("failed"), "checks-failed");
  assert.equal(checksTone(null), "");
});

test("short age: 6m, 2h, 2d, weeks, years", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(shortAge(ago(20), now), "now");
  assert.equal(shortAge(ago(6 * 60), now), "6m");
  assert.equal(shortAge(ago(2 * 3600 + 59), now), "2h");
  assert.equal(shortAge(ago(2 * 86400), now), "2d");
  assert.equal(shortAge(ago(21 * 86400), now), "3w");
  assert.equal(shortAge(ago(400 * 86400), now), "1y");
  assert.equal(shortAge(now - 6 * 60_000, now), "6m");
  assert.equal(shortAge("not a date", now), "");
  // git stash's %ci
  assert.equal(shortAge("2026-10-27 13:00:00 +0100", now), "2d");
  // A clock slightly ahead is not "-1m"
  assert.equal(shortAge(now + 5000, now), "now");
});

const pr = (over: Partial<PRSummary> = {}): PRSummary => ({
  number: 106,
  url: "https://github.com/o/r/pull/106",
  state: "open",
  title: "Deck state line opens the live activity",
  isDraft: false,
  checks: "passed",
  body: "",
  changedFiles: 2,
  additions: 59,
  deletions: 23,
  headRefName: "fix/deck-live-activity",
  baseRefName: "main",
  author: "Claude",
  createdAt: "2026-10-29T11:54:00Z",
  ...over,
});

test("PR captions (E-Git, D-Git)", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(prStateCaption(pr()), "Open · 2 files");
  assert.equal(
    prStateCaption(pr({ changedFiles: 1, state: "merged" })),
    "Merged · 1 file"
  );
  assert.equal(prStateCaption(pr({ isDraft: true })), "Draft · 2 files");
  assert.equal(
    prMetaCaption(pr(), now),
    "fix/deck-live-activity → main · 2 files · opened by Claude 6m ago"
  );
  assert.equal(
    prMetaCaption(pr({ author: "", createdAt: "" }), now),
    "fix/deck-live-activity → main · 2 files"
  );
});

test("PR blurb: the first real paragraph, plain", () => {
  assert.equal(
    prBlurb(
      "## Summary\n\nIn the **half-folded** pose the deck\nreplaces the [strip](http://x).\n\nMore."
    ),
    "In the half-folded pose the deck replaces the strip."
  );
  assert.equal(
    prBlurb("<!-- template -->\n- [ ] tested\n\n- Fixes `x`"),
    "Fixes x"
  );
  assert.equal(prBlurb(""), "");
});

const f = (
  path: string,
  status: GitFile["status"],
  staged = false,
  repoPath?: string
) => ({
  path,
  status,
  staged,
  ...(repoPath ? { repoPath } : {}),
});

test("commit target: only the staged when anything is", () => {
  const t = commitTarget(
    {
      staged: [f("a.ts", "modified", true)],
      unstaged: [f("b.ts", "modified")],
      untracked: [f("c.ts", "untracked")],
    },
    "/r"
  );
  assert.deepEqual(t, {
    staged: true,
    count: 1,
    groups: [{ repoPath: "/r", files: ["a.ts"] }],
  });
});

test("commit target: else everything listed, per repo, once each", () => {
  const t = commitTarget(
    {
      staged: [],
      unstaged: [f("b.ts", "modified"), f("x.ts", "deleted", false, "/other")],
      untracked: [f("c.ts", "untracked"), f("b.ts", "modified")],
    },
    "/r"
  );
  assert.equal(t.staged, false);
  assert.equal(t.count, 3);
  assert.deepEqual(t.groups, [
    { repoPath: "/r", files: ["b.ts", "c.ts"] },
    { repoPath: "/other", files: ["x.ts"] },
  ]);
  assert.deepEqual(
    commitTarget({ staged: [], unstaged: [], untracked: [] }, "/r"),
    { staged: false, count: 0, groups: [] }
  );
});

test("commit label", () => {
  assert.equal(commitLabel(2), "Commit 2 files");
  assert.equal(commitLabel(1), "Commit 1 file");
  assert.equal(commitLabel(0), "Commit");
});

test("own commits: the newest aheadOfBase on This branch only", () => {
  assert.deepEqual(
    [0, 1, 2].map((i) => isOwnCommit(i, 2, true)),
    [true, true, false]
  );
  assert.equal(isOwnCommit(0, 2, false), false);
  assert.equal(isOwnCommit(0, 0, true), false);
});

test("on the base branch; changed files in list order", () => {
  assert.equal(onBaseBranch("main", info()), true);
  assert.equal(onBaseBranch("fix/x", info()), false);
  assert.equal(onBaseBranch("main", info({ baseBranch: null })), false);
  const s = {
    staged: [f("a", "added", true)],
    unstaged: [f("b", "modified")],
    untracked: [f("c", "untracked")],
  };
  assert.deepEqual(
    changedFiles(s).map((x) => x.path),
    ["a", "b", "c"]
  );
});
