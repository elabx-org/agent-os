import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arrivedNoticeText,
  moveStepText,
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
