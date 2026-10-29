import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";

const SUMMARY_COLUMNS = [
  "session_id",
  "basis",
  "text",
  "tokens",
  "source",
  "empty",
  "created_at",
];

function quietly(fn: () => void) {
  const log = console.log;
  console.log = () => {};
  try {
    fn();
  } finally {
    console.log = log;
  }
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );

function migrated(): Database.Database {
  const db = new Database(":memory:");
  createSchema(db);
  quietly(() => runMigrations(db));
  return db;
}

/** Back to before migration 31 */
function unapply(db: Database.Database, keepColumn = false) {
  db.exec(`DROP TABLE IF EXISTS session_summaries`);
  if (!keepColumn) db.exec(`ALTER TABLE session_queue DROP COLUMN sessions`);
  db.exec(`DELETE FROM _migrations WHERE id = 31`);
}

const applied31 = (db: Database.Database) =>
  db.prepare(`SELECT id FROM _migrations WHERE id = 31`).all().length;

test("migration 31 adds session_summaries and session_queue.sessions", () => {
  const db = migrated();
  assert.deepEqual(columns(db, "session_summaries"), SUMMARY_COLUMNS);
  assert.ok(columns(db, "session_queue").includes("sessions"));
  assert.equal(applied31(db), 1);
});

test("migration 31 runs twice without harm", () => {
  const db = migrated();
  unapply(db);
  quietly(() => runMigrations(db));
  db.exec(`DELETE FROM _migrations WHERE id = 31`);
  quietly(() => runMigrations(db));
  assert.deepEqual(columns(db, "session_summaries"), SUMMARY_COLUMNS);
  assert.equal(
    columns(db, "session_queue").filter((c) => c === "sessions").length,
    1
  );
  assert.equal(applied31(db), 1);
});

test("migration 31 with session_queue.sessions already there", () => {
  const db = migrated();
  unapply(db, true);
  db.prepare(
    `INSERT INTO session_queue (session_id, position, text, origin, kind, status, created_at, sessions)
     VALUES ('s', 1, 'hi', 'user', 'message', 'pending', 1, '[{"sessionId":"a"}]')`
  ).run();
  quietly(() => runMigrations(db));
  assert.deepEqual(columns(db, "session_summaries"), SUMMARY_COLUMNS);
  assert.equal(applied31(db), 1);
  const row = db.prepare(`SELECT sessions FROM session_queue`).get();
  assert.deepEqual(row, { sessions: '[{"sessionId":"a"}]' });
});

test("session_summaries keeps one row per session", () => {
  const db = migrated();
  const put = db.prepare(
    `INSERT INTO session_summaries (session_id, basis, text, tokens, source, created_at)
     VALUES ('s', ?, 't', 1, 'transcript', 1)
     ON CONFLICT(session_id) DO UPDATE SET basis = excluded.basis`
  );
  put.run("a");
  put.run("b");
  assert.deepEqual(
    db.prepare(`SELECT session_id, basis, empty FROM session_summaries`).all(),
    [{ session_id: "s", basis: "b", empty: 0 }]
  );
});
