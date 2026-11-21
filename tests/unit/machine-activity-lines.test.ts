import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityLine,
  activitySummary,
} from "../../components/Settings/machine-activity";
import type { MachineAction } from "../../lib/link/machine-actions";

const action = (over: Partial<MachineAction>): MachineAction => ({
  id: 1,
  machine_id: "m_000000000001",
  machine_name: "Mac",
  action: "start",
  target_session_id: "s",
  target_name: "Fix it",
  target_machine_id: null,
  detail: "The task",
  allowed: 1,
  at: 1,
  ...over,
});

test("activity lines: in the plan's words", () => {
  const name = () => "Mac mini";
  assert.deepEqual(activityLine(action({})), {
    text: 'started "Fix it"',
    detail: "The task",
  });
  assert.equal(
    activityLine(action({ action: "message" })).text,
    'sent a message to "Fix it"'
  );
  assert.equal(
    activityLine(action({ action: "answer" })).text,
    'answered a question in "Fix it"'
  );
  assert.equal(
    activityLine(action({ action: "interrupt" })).text,
    'interrupted "Fix it"'
  );
  assert.equal(
    activityLine(
      action({ action: "stop", target_machine_id: "m_abcdefabcdef" }),
      name
    ).text,
    'stopped "Fix it" on Mac mini'
  );
  assert.deepEqual(
    activityLine(action({ action: "refused", detail: "It's switched off" })),
    { text: "was refused: It's switched off", detail: null }
  );
});

test("activity summary: nothing yet, or today's count", () => {
  const now = new Date(2026, 10, 21, 12).getTime();
  assert.equal(activitySummary([], now), "Nothing yet");
  assert.equal(
    activitySummary([{ at: now - 1000 }, { at: now - 2 * 86400_000 }], now),
    "1 today"
  );
});
