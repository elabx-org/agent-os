import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_SETTLE_TOAST_MS,
  doneTodayItems,
  freshAutoSettles,
  settleCaption,
  settledTodayList,
  settleErrorText,
  withPendingSettles,
} from "../../components/MissionControl/settle-model";
import type { Session } from "../../lib/db/types";
import { pendingRemoval } from "../../stores/pendingRemoval";
import { settleWithUndo, showSettledToast, undoToasts } from "../../lib/undo";

// haptic() posts to the iOS app through window: nothing to post to here
(globalThis as { window?: unknown }).window ??= {};

const day = new Date(2026, 9, 29, 15, 0).getTime();
const HOUR = 3600_000;

const session = (id: string, over: Partial<Session> = {}) =>
  ({
    id,
    name: id,
    conductor_session_id: null,
    settled_at: null,
    settled_reason: null,
    pr_number: null,
    pr_status: null,
    ...over,
  }) as Session;

test("withPendingSettles: a swiped session reads settled by hand at once", () => {
  const list = [session("a"), session("b")];
  const out = withPendingSettles(list, { b: day });
  assert.equal(out[0], list[0]);
  assert.equal(out[1].settled_at, day);
  assert.equal(out[1].settled_reason, "manual");
  // Nothing pending: the same array, so memos hold
  assert.equal(withPendingSettles(list, {}), list);
});

test("withPendingSettles: the server's settle wins", () => {
  const list = [
    session("a", { settled_at: day - HOUR, settled_reason: "pr_merged" }),
  ];
  const [a] = withPendingSettles(list, { a: day });
  assert.equal(a.settled_at, day - HOUR);
  assert.equal(a.settled_reason, "pr_merged");
});

test("settledTodayList: today's only, no workers, newest first", () => {
  const list = [
    session("old", { settled_at: day - 24 * HOUR }),
    session("early", { settled_at: day - 2 * HOUR }),
    session("late", { settled_at: day - HOUR }),
    session("worker", { settled_at: day, conductor_session_id: "late" }),
    session("live"),
  ];
  assert.deepEqual(
    settledTodayList(list, day).map((s) => s.id),
    ["late", "early"]
  );
});

test("doneTodayItems: the PR number only when it merged", () => {
  const items = doneTodayItems(
    [
      session("a", { settled_at: day, pr_number: 106, pr_status: "merged" }),
      session("b", { settled_at: day - 1, pr_number: 107, pr_status: "open" }),
    ],
    (s) => `T ${s.id}`
  );
  assert.deepEqual(items, [
    { sessionId: "a", title: "T a", prNumber: 106, at: day },
    { sessionId: "b", title: "T b", at: day - 1 },
  ]);
});

test("freshAutoSettles: auto-settled in the last two minutes, once", () => {
  const list = [
    session("new", { settled_at: day - 1000, settled_reason: "pr_merged" }),
    session("stale", {
      settled_at: day - AUTO_SETTLE_TOAST_MS - 1,
      settled_reason: "pr_merged",
    }),
    session("manual", { settled_at: day, settled_reason: "manual" }),
    session("here", { settled_at: day, settled_reason: "pr_merged_here" }),
    session("undone", { settled_at: null, settled_reason: "unsettled" }),
    session("shown", { settled_at: day, settled_reason: "pr_merged" }),
  ];
  assert.deepEqual(
    freshAutoSettles(list, new Set(["shown"]), day).map((s) => s.id),
    ["new"]
  );
});

test("settleCaption: the merged PR, else the chat", () => {
  assert.equal(
    settleCaption({ pr_number: 106, pr_status: "merged" }),
    "PR #106 merged"
  );
  assert.equal(
    settleCaption({ pr_number: 107, pr_status: "open" }),
    "The chat stays readable"
  );
});

test("settleErrorText: refusals in words", () => {
  assert.equal(
    settleErrorText({ error: "x", reason: "busy" }),
    "It is still working"
  );
  assert.equal(
    settleErrorText({ error: "x", reason: "already_settled" }),
    "It's already settled"
  );
  assert.equal(settleErrorText({ error: "Not found" }), "Not found");
  assert.equal(
    settleErrorText({ error: "user_only", reason: "no_proof" }),
    "Reload to confirm it's you"
  );
  assert.equal(settleErrorText({}), "Something went wrong");
});

test("settleWithUndo: settled at once, sent after the window", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let sent = 0;
    settleWithUndo({
      id: "s1",
      title: "Deck fix",
      caption: "PR #106 merged",
      commit: async () => {
        sent++;
      },
    });
    assert.ok(pendingRemoval.settles.s1);
    assert.equal(undoToasts.list.at(-1)?.title, "Deck fix settled");
    assert.equal(undoToasts.list.at(-1)?.caption, "PR #106 merged");
    mock.timers.tick(4999);
    assert.equal(sent, 0);
    mock.timers.tick(1);
    assert.equal(sent, 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(pendingRemoval.settles.s1, undefined);
    assert.equal(undoToasts.list.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("settleWithUndo: Undo never sends the settle", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let sent = 0;
    settleWithUndo({
      id: "s2",
      title: "Signing profiles",
      commit: async () => {
        sent++;
      },
    });
    undoToasts.list.at(-1)!.onUndo();
    assert.equal(pendingRemoval.settles.s2, undefined);
    assert.equal(undoToasts.list.length, 0);
    mock.timers.tick(10_000);
    assert.equal(sent, 0);
  } finally {
    mock.timers.reset();
  }
});

test("showSettledToast: Undo runs the unsettle", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let undone = 0;
    showSettledToast({
      title: "Deck fix",
      caption: "PR #106 merged",
      undo: async () => {
        undone++;
      },
    });
    assert.equal(undoToasts.list.at(-1)?.title, "Deck fix settled");
    undoToasts.list.at(-1)!.onUndo();
    assert.equal(undone, 1);
    assert.equal(undoToasts.list.length, 0);
  } finally {
    mock.timers.reset();
  }
});
