import { test } from "node:test";
import assert from "node:assert/strict";
import { parentOf, startTicks } from "../../lib/running";

// /proc/<pid>/stat with a command holding spaces and parentheses
const STAT =
  "4242 (node (vite) x) S 4100 4242 4100 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 11 0 987654 1000 200 18446744073709551615";

test("parentOf reads the ppid after the command", () => {
  assert.equal(parentOf(STAT), 4100);
  assert.equal(parentOf("1 (init) S 0 1 1"), null);
});

test("startTicks reads field 22", () => {
  assert.equal(startTicks(STAT), 987654);
});
