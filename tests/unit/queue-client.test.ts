import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QueueRequestError,
  composerExpanded,
  dropIndex,
  holdCaption,
  holdsSend,
  isQueueOff,
  moveItem,
  noticeChipText,
  patchItem,
  queueErrorText,
  removeItem,
  turnNoOfNotice,
  upsertItem,
} from "../../components/Composer/queue-model";
import {
  splitUndoNotice,
  takesNotice,
  undoNoticeText,
  type QueueItem,
} from "../../lib/queue/types";

function item(id: number, position: number, extra: Partial<QueueItem> = {}) {
  return {
    id,
    sessionId: "s1",
    position,
    text: `message ${id}`,
    attachments: [],
    origin: "user",
    kind: "message",
    status: "pending",
    notBefore: null,
    createdAt: 0,
    sentAt: null,
    error: null,
    ...extra,
  } satisfies QueueItem;
}

const ids = (items: QueueItem[]) => items.map((i) => i.id);

test("moveItem reorders among pending and renumbers", () => {
  const items = [item(1, 1), item(2, 2), item(3, 3)];
  const moved = moveItem(items, 3, 1);
  assert.deepEqual(ids(moved), [3, 1, 2]);
  assert.deepEqual(
    moved.map((i) => i.position),
    [1, 2, 3]
  );
  assert.deepEqual(ids(moveItem(items, 1, 3)), [2, 3, 1]);
  // Out of range clamps; unknown ids change nothing
  assert.deepEqual(ids(moveItem(items, 1, 99)), [2, 3, 1]);
  assert.deepEqual(ids(moveItem(items, 2, 0)), [2, 1, 3]);
  assert.deepEqual(ids(moveItem(items, 9, 1)), [1, 2, 3]);
  // The original is untouched
  assert.deepEqual(ids(items), [1, 2, 3]);
});

test("moveItem keeps an item being sent first", () => {
  const items = [item(1, 1, { status: "sending" }), item(2, 2), item(3, 3)];
  assert.deepEqual(ids(moveItem(items, 3, 1)), [1, 3, 2]);
  // The one being sent isn't movable
  assert.deepEqual(ids(moveItem(items, 1, 2)), [1, 2, 3]);
});

test("remove, patch and upsert", () => {
  const items = [item(1, 1), item(2, 2)];
  assert.deepEqual(ids(removeItem(items, 1)), [2]);
  assert.equal(patchItem(items, 2, { text: "new" })[1].text, "new");
  assert.equal(patchItem(items, 2, { text: "new" })[0], items[0]);
  assert.deepEqual(ids(upsertItem(items, item(3, 3))), [1, 2, 3]);
  const replaced = upsertItem(items, item(2, 2, { text: "server" }));
  assert.deepEqual(ids(replaced), [1, 2]);
  assert.equal(replaced[1].text, "server");
});

test("dropIndex counts the other rows above the pointer", () => {
  const mids = [10, 70, 130];
  assert.equal(dropIndex(mids, 0, 10), 0);
  assert.equal(dropIndex(mids, 0, 80), 1);
  assert.equal(dropIndex(mids, 0, 200), 2);
  assert.equal(dropIndex(mids, 2, 0), 0);
  assert.equal(dropIndex(mids, 2, 60), 1);
  assert.equal(dropIndex(mids, 1, 69), 1);
});

test("hold reasons read as captions", () => {
  assert.equal(
    holdCaption(null, "Claude"),
    "Sends when Claude is done. Held while it asks you something."
  );
  assert.equal(
    holdCaption("busy", "Codex"),
    "Sends when Codex is done. Held while it asks you something."
  );
  assert.equal(
    holdCaption("typing", "Claude"),
    "Held: text is half-typed in the terminal"
  );
  assert.equal(
    holdCaption("unknown", "Claude"),
    "Held until Claude's screen is clear"
  );
  for (const reason of ["asking", "permission", "limited", "paused"] as const)
    assert.match(holdCaption(reason, "Claude"), /^Held/);
});

test("Queue replaces Send only while the queue is on and held", () => {
  assert.equal(holdsSend({ enabled: true, ready: false }), true);
  assert.equal(holdsSend({ enabled: true, ready: true }), false);
  assert.equal(holdsSend({ enabled: false, ready: false }), false);
});

test("errors in words, and queue_off falls back", () => {
  assert.equal(
    queueErrorText(403, { error: "user_only", reason: "no_proof" }),
    "Reload to confirm it's you"
  );
  assert.equal(
    queueErrorText(403, { error: "user_only" }),
    "Only you can do this, in AgentOS"
  );
  assert.equal(
    queueErrorText(400, { error: "Text is empty" }),
    "Text is empty"
  );
  assert.match(queueErrorText(409, null), /on its way/);
  assert.equal(queueErrorText(500, null), "Couldn't reach the queue");

  assert.equal(isQueueOff(new QueueRequestError("x", 409, "queue_off")), true);
  assert.equal(isQueueOff(new QueueRequestError("x", 501, null)), true);
  assert.equal(isQueueOff(new QueueRequestError("x", 409, "busy")), false);
  assert.equal(isQueueOff(new Error("queue_off")), false);
});

test("the card opens for focus, text, attachments, queue or notice", () => {
  const none = {
    focused: false,
    text: "",
    attachments: 0,
    queued: 0,
    notice: false,
  };
  assert.equal(composerExpanded(none), false);
  assert.equal(composerExpanded({ ...none, focused: true }), true);
  assert.equal(composerExpanded({ ...none, text: "a" }), true);
  assert.equal(composerExpanded({ ...none, attachments: 1 }), true);
  assert.equal(composerExpanded({ ...none, queued: 2 }), true);
  assert.equal(composerExpanded({ ...none, notice: true }), true);
});

test("the notice chip names the undone turn", () => {
  const text = undoNoticeText(4, ["a.ts", "b.ts"]);
  assert.equal(turnNoOfNotice(text), 4);
  assert.equal(
    noticeChipText(text, "Claude"),
    "Claude will be told turn 4 was undone"
  );
  assert.equal(
    noticeChipText("something else", "Claude"),
    "Claude will be told about the undo"
  );
});

test("the undo notice rides on plain messages only", () => {
  assert.equal(takesNotice("carry on"), true);
  assert.equal(takesNotice("/clear"), false);
  assert.equal(takesNotice("  /model sonnet"), false);
  assert.equal(takesNotice("! ls"), false);
  assert.equal(takesNotice("# remember this"), false);
});

test("a sent message shows without its undo notice", () => {
  const sent = `${undoNoticeText(1, ["src/added.ts", "src/app.ts"])} carry on`;
  assert.deepEqual(splitUndoNotice(sent), {
    text: "carry on",
    undoneTurn: 1,
  });
  assert.deepEqual(splitUndoNotice("[AgentOS] hi"), {
    text: "[AgentOS] hi",
    undoneTurn: null,
  });
});
