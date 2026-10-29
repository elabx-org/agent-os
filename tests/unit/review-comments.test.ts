import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";
import type { NewReviewComment } from "../../lib/review-types";

// lib/review-comments imports lib/db, which reads DB_PATH when it loads; the
// tests only use their own in-memory DB, never getDb()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-review-"));
process.env.DB_PATH = path.join(tmp, "unused.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let mod: typeof import("../../lib/review-comments");
let db: Database.Database;
let store: ReturnType<
  typeof import("../../lib/review-comments").createReviewStore
>;

before(async () => {
  mod = await import("../../lib/review-comments");
});

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    runMigrations(db);
  } finally {
    console.log = log;
  }
  store = mod.createReviewStore(db);
});

const S = "session-a";
const input = (extra: Partial<NewReviewComment> = {}): NewReviewComment => ({
  scope: "turn:4",
  path: "components/DeckStateLine.tsx",
  side: "new",
  startLine: 22,
  endLine: 22,
  quote: "<ChevronRight />",
  body: "Keep the chevron muted",
  ...extra,
});

test("add stores a pending comment and get reads it back", () => {
  const c = store.add(S, input());
  assert.equal(c.sessionId, S);
  assert.equal(c.scope, "turn:4");
  assert.equal(c.sentAt, null);
  assert.ok(c.createdAt > 0);
  assert.deepEqual(store.get(S, c.id), c);
  assert.equal(store.get("other", c.id), null);
});

test("add with sent records it sent", () => {
  const c = store.add(S, input({ sent: true }));
  assert.equal(c.sentAt, c.createdAt);
});

test("list: pending oldest first, then sent newest first; scope filters", () => {
  const a = store.add(S, input({ body: "a" }));
  const b = store.add(S, input({ body: "b", scope: "branch" }));
  const c = store.add(S, input({ body: "c" }));
  const d = store.add(S, input({ body: "d" }));
  store.markSent(S, [a.id], 1000);
  store.markSent(S, [d.id], 2000);
  assert.deepEqual(
    store.list(S).map((x) => x.body),
    ["b", "c", "d", "a"]
  );
  assert.deepEqual(
    store.list(S, "turn:4").map((x) => x.body),
    ["c", "d", "a"]
  );
  assert.deepEqual(
    store.list(S, "branch").map((x) => x.id),
    [b.id]
  );
  assert.deepEqual(store.list("other"), []);
});

test("edit and remove touch pending comments only", () => {
  const p = store.add(S, input());
  const s = store.add(S, input({ sent: true }));
  assert.equal(store.edit(S, p.id, "new text")?.body, "new text");
  assert.equal(store.edit(S, s.id, "nope"), null);
  assert.equal(store.edit(S, 9999, "nope"), null);
  assert.equal(store.edit("other", p.id, "nope"), null);
  assert.equal(store.get(S, s.id)?.body, "Keep the chevron muted");
  assert.equal(store.remove(S, s.id), false);
  assert.equal(store.remove("other", p.id), false);
  assert.equal(store.remove(S, p.id), true);
  assert.equal(store.remove(S, p.id), false);
  assert.deepEqual(
    store.list(S).map((c) => c.id),
    [s.id]
  );
});

test("markSent flips the session's pending ones once", () => {
  const a = store.add(S, input());
  const b = store.add(S, input());
  const other = store.add("other", input());
  const first = store.markSent(S, [a.id, b.id, a.id, other.id, 9999], 500);
  assert.deepEqual(
    first.map((c) => [c.id, c.sentAt]),
    [
      [a.id, 500],
      [b.id, 500],
    ]
  );
  // Again: nothing pending among them, sent times stay
  assert.deepEqual(store.markSent(S, [a.id, b.id], 900), []);
  assert.equal(store.get(S, a.id)?.sentAt, 500);
  assert.equal(store.get("other", other.id)?.sentAt, null);
});

test("discardPending drops the pending ones and keeps the sent", () => {
  store.add(S, input());
  store.add(S, input());
  const s = store.add(S, input({ sent: true }));
  const other = store.add("other", input());
  assert.equal(store.discardPending(S), 2);
  assert.equal(store.discardPending(S), 0);
  assert.deepEqual(
    store.list(S).map((c) => c.id),
    [s.id]
  );
  assert.ok(store.get("other", other.id));
});

test("removeSession drops every comment of that session only", () => {
  store.add(S, input());
  store.add(S, input({ sent: true }));
  const other = store.add("other", input());
  store.removeSession(S);
  assert.deepEqual(store.list(S), []);
  assert.ok(store.get("other", other.id));
});

test("sent history is capped per session", () => {
  for (let i = 0; i < mod.SENT_HISTORY + 5; i++) {
    const c = store.add(S, input({ body: `c${i}` }));
    store.markSent(S, [c.id], 1000 + i);
  }
  const pending = store.add(S, input({ body: "pending" }));
  const list = store.list(S);
  assert.equal(list.length, mod.SENT_HISTORY + 1);
  assert.equal(list[0].id, pending.id);
  assert.equal(list[1].body, `c${mod.SENT_HISTORY + 4}`);
  assert.equal(list.at(-1)!.body, "c5");
});

test("parseReviewScope takes the diff route's scopes", () => {
  assert.equal(mod.parseReviewScope("branch"), "branch");
  assert.equal(mod.parseReviewScope("uncommitted"), "uncommitted");
  assert.equal(mod.parseReviewScope("turn:07"), "turn:7");
  assert.equal(mod.parseReviewScope("turn:x"), null);
  assert.equal(mod.parseReviewScope("all"), null);
  assert.equal(mod.parseReviewScope(4), null);
});

test("parseNewComment validates every field", () => {
  const ok = mod.parseNewComment({
    ...input(),
    path: "./a//b.ts",
    body: " hi ",
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.comment.path, "a/b.ts");
    assert.equal(ok.comment.body, "hi");
    assert.equal(ok.comment.sent, false);
  }
  const bad = (extra: Record<string, unknown>) => {
    const r = mod.parseNewComment({ ...input(), ...extra });
    return r.ok ? null : r.error;
  };
  assert.equal(bad({ scope: "nope" }), "Bad scope");
  assert.equal(bad({ path: "../etc/passwd" }), "Bad file");
  assert.equal(bad({ path: "/abs" }), "Bad file");
  assert.equal(bad({ path: "" }), "Bad file");
  assert.equal(bad({ side: "both" }), "Bad side");
  assert.equal(bad({ startLine: 0 }), "Bad lines");
  assert.equal(bad({ startLine: 5, endLine: 4 }), "Bad lines");
  assert.equal(bad({ endLine: 2.5 }), "Bad lines");
  assert.equal(bad({ body: "  " }), "Comment required");
  assert.equal(bad({ body: "x".repeat(10_001) }), "Comment too long");
  assert.equal(bad({ quote: 3 }), "Bad quote");
  assert.equal(bad({ sent: "yes" }), "Bad sent");
  assert.equal(mod.parseNewComment(null).ok, false);
});

test("parseCommentBody", () => {
  assert.deepEqual(mod.parseCommentBody({ body: " x " }), {
    ok: true,
    body: "x",
  });
  assert.equal(mod.parseCommentBody({ body: "" }).ok, false);
  assert.equal(mod.parseCommentBody(null).ok, false);
});
