import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";

function quietly(fn: () => void) {
  const log = console.log;
  console.log = () => {};
  try {
    fn();
  } finally {
    console.log = log;
  }
}

function migrated(): Database.Database {
  const db = new Database(":memory:");
  createSchema(db);
  quietly(() => runMigrations(db));
  return db;
}

const columns = (db: Database.Database) =>
  (
    db.prepare(`PRAGMA table_info(review_comments)`).all() as {
      name: string;
    }[]
  ).map((c) => c.name);

const hasIndex = (db: Database.Database) =>
  !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_review_comments_session'`
    )
    .get();

const COLUMNS = [
  "id",
  "session_id",
  "scope",
  "path",
  "side",
  "start_line",
  "end_line",
  "quote",
  "body",
  "created_at",
  "sent_at",
];

test("migration 33 adds review_comments and its index, recorded once", () => {
  const db = migrated();
  assert.deepEqual(columns(db), COLUMNS);
  assert.ok(hasIndex(db));
  const ids = db.prepare(`SELECT id FROM _migrations WHERE id = 33`).all();
  assert.equal(ids.length, 1);
});

test("migration 33 runs twice without harm", () => {
  const db = migrated();
  db.exec(`DELETE FROM _migrations WHERE id = 33`);
  quietly(() => runMigrations(db));
  db.exec(`DELETE FROM _migrations WHERE id = 33`);
  quietly(() => runMigrations(db));
  assert.deepEqual(columns(db), COLUMNS);
  assert.ok(hasIndex(db));
});

test("migration 33 on a DB where the table exists keeps its rows and adds the index", () => {
  const db = migrated();
  db.exec(`DROP INDEX idx_review_comments_session`);
  db.exec(`DELETE FROM _migrations WHERE id = 33`);
  db.prepare(
    `INSERT INTO review_comments
       (session_id, scope, path, start_line, end_line, quote, body, created_at)
     VALUES ('s', 'branch', 'a.ts', 1, 2, 'q', 'b', 1)`
  ).run();
  quietly(() => runMigrations(db));
  assert.ok(hasIndex(db));
  const row = db
    .prepare(`SELECT side, sent_at FROM review_comments WHERE session_id = 's'`)
    .get();
  assert.deepEqual(row, { side: "new", sent_at: null });
});
