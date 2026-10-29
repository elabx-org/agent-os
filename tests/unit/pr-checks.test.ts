import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldChecks,
  pickPR,
  toPRSummary,
  type CheckRollupEntry,
  type GhPR,
} from "../../lib/pr";

const run = (
  status: string,
  conclusion: string | null = null
): CheckRollupEntry => ({ __typename: "CheckRun", status, conclusion });
const ctx = (state: string): CheckRollupEntry => ({
  __typename: "StatusContext",
  state,
});

test("foldChecks: no checks is null", () => {
  assert.equal(foldChecks(undefined), null);
  assert.equal(foldChecks(null), null);
  assert.equal(foldChecks([]), null);
});

test("foldChecks: all finished well passes", () => {
  assert.equal(foldChecks([run("COMPLETED", "SUCCESS")]), "passed");
  assert.equal(
    foldChecks([
      run("COMPLETED", "SUCCESS"),
      run("COMPLETED", "NEUTRAL"),
      run("COMPLETED", "SKIPPED"),
      ctx("SUCCESS"),
    ]),
    "passed"
  );
});

test("foldChecks: any failure fails, even with others still running", () => {
  for (const conclusion of [
    "FAILURE",
    "ERROR",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
  ]) {
    assert.equal(
      foldChecks([run("COMPLETED", "SUCCESS"), run("COMPLETED", conclusion)]),
      "failed",
      conclusion
    );
  }
  assert.equal(foldChecks([ctx("FAILURE"), run("IN_PROGRESS")]), "failed");
  assert.equal(foldChecks([ctx("ERROR")]), "failed");
  assert.equal(foldChecks([run("COMPLETED", "failure")]), "failed");
});

test("foldChecks: anything not finished is pending", () => {
  for (const status of ["QUEUED", "IN_PROGRESS", "PENDING", "WAITING"]) {
    assert.equal(
      foldChecks([run("COMPLETED", "SUCCESS"), run(status)]),
      "pending",
      status
    );
  }
  assert.equal(foldChecks([ctx("PENDING"), ctx("SUCCESS")]), "pending");
  assert.equal(foldChecks([ctx("EXPECTED")]), "pending");
});

const pr = (n: number, state: string, createdAt: string): GhPR => ({
  number: n,
  url: `https://github.com/o/r/pull/${n}`,
  state,
  title: `PR ${n}`,
  createdAt,
});

test("pickPR: an open PR wins over a newer merged one", () => {
  const picked = pickPR([
    pr(9, "MERGED", "2026-10-20T00:00:00Z"),
    pr(4, "OPEN", "2026-09-01T00:00:00Z"),
  ]);
  assert.equal(picked?.number, 4);
});

test("pickPR: without an open one, the most recent", () => {
  const picked = pickPR([
    pr(3, "CLOSED", "2026-08-01T00:00:00Z"),
    pr(7, "MERGED", "2026-10-01T00:00:00Z"),
    pr(5, "CLOSED", "2026-09-01T00:00:00Z"),
  ]);
  assert.equal(picked?.number, 7);
  assert.equal(pickPR([]), null);
});

test("toPRSummary: state lowercased, author's login, checks folded, defaults filled", () => {
  const summary = toPRSummary({
    ...pr(12, "MERGED", "2026-10-28T09:00:00Z"),
    isDraft: false,
    statusCheckRollup: [run("COMPLETED", "SUCCESS")],
    body: null,
    changedFiles: 3,
    additions: 38,
    deletions: 9,
    headRefName: "feature/x",
    baseRefName: "main",
    author: { login: "octo" },
  });
  assert.deepEqual(summary, {
    number: 12,
    url: "https://github.com/o/r/pull/12",
    state: "merged",
    title: "PR 12",
    isDraft: false,
    checks: "passed",
    body: "",
    changedFiles: 3,
    additions: 38,
    deletions: 9,
    headRefName: "feature/x",
    baseRefName: "main",
    author: "octo",
    createdAt: "2026-10-28T09:00:00Z",
  });
  const bare = toPRSummary({ number: 1, url: "u", state: "OPEN", title: "t" });
  assert.equal(bare.state, "open");
  assert.equal(bare.checks, null);
  assert.equal(bare.author, "");
  assert.equal(toPRSummary(pr(2, "CLOSED", "")).state, "closed");
});
