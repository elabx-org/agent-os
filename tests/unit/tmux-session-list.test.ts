import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SESSION_LIST_FORMAT,
  parseSessionList,
} from "../../lib/status-detector";

test("status: the tmux session list is read without a tab", () => {
  // tmux 3.5+ without a UTF-8 locale prints control characters as "_"
  assert.equal(/[\t\x00-\x1f]/.test(SESSION_LIST_FORMAT), false);
  const got = parseSessionList(
    "1795435146 claude-60a93467-abe3-4ce6-ab39-f5934bf1024c\n1795435353 my own session\n\nbroken\n"
  );
  assert.deepEqual(
    [...got],
    [
      ["claude-60a93467-abe3-4ce6-ab39-f5934bf1024c", 1795435146],
      ["my own session", 1795435353],
    ]
  );
});
