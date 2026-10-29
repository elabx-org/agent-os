import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handedOffLine,
  pausedLast,
  sessionState,
  successorOf,
  withoutPaused,
} from "../../lib/paused";

const name = (type: string | null | undefined) =>
  ({ claude: "Claude", codex: "Codex", gemini: "Gemini" })[type || "claude"] ??
  String(type);

test("sessionState: paused wins over any status", () => {
  for (const status of ["running", "waiting", "idle", "dead", undefined])
    assert.equal(sessionState({ paused_at: 1 }, status), "paused");
});

test("sessionState: otherwise the status's state, with the fallback", () => {
  assert.equal(sessionState({ paused_at: null }, "waiting"), "needs");
  assert.equal(sessionState({ paused_at: null }, "running"), "work");
  assert.equal(sessionState({ paused_at: null }, undefined), "idle");
  assert.equal(sessionState({ paused_at: null }, undefined, "dead"), "stopped");
  assert.equal(sessionState(null, "running"), "work");
});

test("successorOf: the listed session it was handed to", () => {
  const list = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(successorOf({ handoff_to_session_id: "b" }, list), {
    id: "b",
  });
  assert.equal(successorOf({ handoff_to_session_id: "gone" }, list), undefined);
  assert.equal(successorOf({ handoff_to_session_id: null }, list), undefined);
});

test("handedOffLine: names the successor's agent", () => {
  const list = [
    { id: "x", agent_type: "codex" },
    { id: "g", agent_type: "gemini" },
    { id: "c", agent_type: null },
  ];
  assert.equal(
    handedOffLine({ handoff_to_session_id: "x" }, list, name),
    "Handed off to Codex"
  );
  assert.equal(
    handedOffLine({ handoff_to_session_id: "g" }, list, name),
    "Handed off to Gemini"
  );
  // agent_type null is Claude
  assert.equal(
    handedOffLine({ handoff_to_session_id: "c" }, list, name),
    "Handed off to Claude"
  );
});

test("handedOffLine: successor gone, or no handoff at all", () => {
  assert.equal(
    handedOffLine({ handoff_to_session_id: "gone" }, [], name),
    "Handed off"
  );
  assert.equal(
    handedOffLine({ handoff_to_session_id: null }, [], name),
    "Paused"
  );
});

test("pausedLast: live first, paused after, order kept within each", () => {
  const list = [
    { id: "p1", paused_at: 1 },
    { id: "l1", paused_at: null },
    { id: "p2", paused_at: 2 },
    { id: "l2", paused_at: null },
  ];
  assert.deepEqual(
    pausedLast(list).map((s) => s.id),
    ["l1", "l2", "p1", "p2"]
  );
});

test("withoutPaused: drops the paused ones only", () => {
  const list = [
    { id: "p", paused_at: 9 },
    { id: "l", paused_at: null },
    { id: "z", paused_at: 0 },
  ];
  // 0 isn't a time it was paused at
  assert.deepEqual(
    withoutPaused(list).map((s) => s.id),
    ["l", "z"]
  );
});
