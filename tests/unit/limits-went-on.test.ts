import { test } from "node:test";
import assert from "node:assert/strict";
import { activitySince } from "../../lib/limits/went-on";

const line = (t: number, event: string) => JSON.stringify({ t, event });

test("activitySince: a prompt or a tool after the limit counts", () => {
  assert.equal(activitySince([line(5, "UserPromptSubmit")], 1), true);
  assert.equal(activitySince([line(5, "PostToolUseFailure")], 1), true);
  assert.equal(activitySince([line(5, "PermissionRequest")], 1), true);
});

test("activitySince: the limit's own events, notifications and junk don't", () => {
  const lines = [
    line(1, "UserPromptSubmit"),
    line(2, "Notification"),
    line(2, "Stop"),
    line(9, "Notification"),
    line(9, "Stop"),
    '{"t": 9, "event": "UserPr',
    "",
  ];
  assert.equal(activitySince(lines, 3), false);
});
