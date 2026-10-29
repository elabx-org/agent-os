import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-queue-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let store: typeof import("../../lib/queue/store");
let db: typeof import("../../lib/db");

before(async () => {
  store = await import("../../lib/queue/store");
  db = await import("../../lib/db");
  // Opening it runs every migration, each with a log line
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().exec("DELETE FROM session_queue");
});

const S = "session-a";
const add = (text: string, extra = {}) =>
  store.enqueue(S, { text, origin: "user", ...extra });
const texts = (id = S) => store.listQueue(id).map((i) => i.text);
const positions = (id = S) => store.listQueue(id).map((i) => i.position);

describe("queue store", () => {
  test("enqueue appends pending items with dense positions", () => {
    const a = add("one", { attachments: ["/tmp/a.png"] });
    add("two");
    add("three", { kind: "command" });
    assert.deepEqual(texts(), ["one", "two", "three"]);
    assert.deepEqual(positions(), [1, 2, 3]);
    assert.equal(a.status, "pending");
    assert.equal(a.kind, "message");
    assert.equal(a.origin, "user");
    assert.deepEqual(a.attachments, ["/tmp/a.png"]);
    assert.equal(store.listQueue("other").length, 0);
    assert.throws(() => add("x", { kind: "undo_notice" }));
  });

  test("editItem changes text and moves among the pending", () => {
    const a = add("one");
    add("two");
    const c = add("three");
    assert.equal(store.editItem(S, a.id, { text: "uno" })?.text, "uno");
    assert.equal(store.editItem(S, c.id, { position: 1 })?.position, 1);
    assert.deepEqual(texts(), ["three", "uno", "two"]);
    store.editItem(S, c.id, { position: 99 });
    assert.deepEqual(texts(), ["uno", "two", "three"]);
    assert.deepEqual(positions(), [1, 2, 3]);
    // Not another session's, not a missing one
    assert.equal(store.editItem("other", a.id, { text: "x" }), null);
    assert.equal(store.editItem(S, 9999, { text: "x" }), null);
  });

  test("a move stays behind the item being sent", () => {
    add("one");
    add("two");
    const c = add("three");
    const q = store.queueStore();
    assert.equal(q.claimNext(S)?.text, "one");
    store.editItem(S, c.id, { position: 1 });
    assert.deepEqual(texts(), ["one", "three", "two"]);
    assert.deepEqual(positions(), [1, 2, 3]);
    assert.equal(store.listQueue(S)[0].status, "sending");
  });

  test("only pending items can be edited or cancelled", () => {
    const a = add("one");
    const b = add("two");
    const q = store.queueStore();
    q.claimNext(S);
    assert.equal(store.editItem(S, a.id, { text: "x" }), null);
    assert.equal(store.cancelItem(S, a.id), false);
    assert.equal(store.cancelItem(S, b.id), true);
    assert.equal(store.cancelItem(S, b.id), false);
    assert.deepEqual(texts(), ["one"]);
  });

  test("cancel renumbers the rest", () => {
    add("one");
    const b = add("two");
    add("three");
    store.cancelItem(S, b.id);
    assert.deepEqual(texts(), ["one", "three"]);
    assert.deepEqual(positions(), [1, 2]);
  });

  test("the undo notice: one pending per session, taken once", () => {
    add("one");
    store.setUndoNotice(S, "first notice");
    const n = store.setUndoNotice(S, "second notice");
    assert.equal(n.kind, "undo_notice");
    assert.equal(n.origin, "system");
    assert.equal(store.getUndoNotice(S)?.text, "second notice");
    // Never listed, never pending work on its own
    assert.deepEqual(texts(), ["one"]);
    assert.equal(store.editItem(S, n.id, { text: "x" }), null);
    assert.equal(store.takeUndoNotice(S), "second notice");
    assert.equal(store.takeUndoNotice(S), null);
    assert.equal(store.getUndoNotice(S), null);
    const sent = store.queueStore().getItem(S, n.id);
    assert.equal(sent?.status, "sent");
    assert.ok(sent?.sentAt);
  });

  test("dropping the notice cancels it", () => {
    const n = store.setUndoNotice(S, "notice");
    assert.equal(store.cancelItem(S, n.id), true);
    assert.equal(store.getUndoNotice(S), null);
  });

  test("sessionsWithPending ignores notices and sent items", () => {
    store.setUndoNotice("only-notice", "n");
    store.enqueue("b", { text: "x", origin: "agent" });
    const q = store.queueStore();
    const c = store.enqueue("c", { text: "y", origin: "user" });
    q.claimNext("c");
    q.markSent("c", c.id);
    assert.deepEqual(store.sessionsWithPending(), ["b"]);
  });

  test("claimNext: one at a time, in order, not before notBefore", () => {
    const q = store.queueStore();
    const now = Date.now();
    const a = add("one", { notBefore: now + 60_000 });
    add("two");
    assert.equal(q.claimNext(S, now), null, "the head waits; order holds");
    store.cancelItem(S, a.id);
    const b = q.claimNext(S, now);
    assert.equal(b?.text, "two");
    assert.equal(b?.status, "sending");
    add("three");
    assert.equal(q.claimNext(S, now), null, "one is being sent");
    assert.equal(q.markSent(S, b!.id), true);
    assert.equal(q.markSent(S, b!.id), false, "only from sending");
    const c = q.claimNext(S, now);
    assert.equal(c?.text, "three");
    assert.equal(q.release(S, c!.id), true);
    assert.equal(store.listQueue(S)[0].status, "pending");
    const again = q.claimNext(S, now)!;
    assert.equal(q.markFailed(S, again.id, "tmux gone"), true);
    const failed = q.getItem(S, again.id);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error, "tmux gone");
    assert.deepEqual(texts(), []);
  });

  test("claimDirect only when nothing is ahead", () => {
    const q = store.queueStore();
    const direct = q.claimDirect(S, { text: "now", origin: "user" });
    assert.equal(direct?.status, "sending");
    assert.equal(q.claimDirect(S, { text: "again", origin: "user" }), null);
    q.markSent(S, direct!.id);
    add("queued");
    assert.equal(q.claimDirect(S, { text: "jump", origin: "user" }), null);
    assert.deepEqual(texts(), ["queued"]);
  });

  test("two connections never claim the same item", () => {
    const other = store.createQueueStore(
      new Database(process.env.DB_PATH!, { timeout: 10_000 })
    );
    const mine = store.queueStore();
    for (let i = 0; i < 5; i++) add(`m${i}`);
    const claimed: string[] = [];
    for (let i = 0; i < 20; i++) {
      const pick = (i % 2 ? mine : other).claimNext(S);
      if (!pick) {
        // The other connection's item is in flight: it finishes it
        const sending = store.listQueue(S).find((x) => x.status === "sending");
        if (sending) (i % 2 ? other : mine).markSent(S, sending.id);
        continue;
      }
      claimed.push(pick.text);
    }
    assert.deepEqual(claimed, ["m0", "m1", "m2", "m3", "m4"]);
  });

  test("failInterrupted fails what a dead process left sending", () => {
    const q = store.queueStore();
    add("one");
    const a = q.claimNext(S)!;
    assert.equal(q.failInterrupted(), 1);
    assert.equal(q.getItem(S, a.id)?.status, "failed");
  });

  test("clearQueue drops everything of the session", () => {
    add("one");
    store.setUndoNotice(S, "n");
    store.enqueue("keep", { text: "k", origin: "user" });
    store.clearQueue(S);
    const left = db
      .getDb()
      .prepare("SELECT session_id FROM session_queue")
      .all() as { session_id: string }[];
    assert.deepEqual(
      left.map((r) => r.session_id),
      ["keep"]
    );
  });
});
