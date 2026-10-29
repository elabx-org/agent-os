import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";

const SETTLE_COLUMNS = [
  "settled_at",
  "settled_reason",
  "pr_checks",
  "pr_title",
  "pr_merged_at",
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

const columns = (db: Database.Database) =>
  (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map(
    (c) => c.name
  );

function migrated(): Database.Database {
  const db = new Database(":memory:");
  createSchema(db);
  quietly(() => runMigrations(db));
  return db;
}

/** Back to before migration 30 */
function unapply(db: Database.Database, keep: string[] = []) {
  for (const c of SETTLE_COLUMNS) {
    if (!keep.includes(c)) db.exec(`ALTER TABLE sessions DROP COLUMN ${c}`);
  }
  db.exec(`DELETE FROM _migrations WHERE id = 30`);
}

test("migration 30 adds the five settle columns, recorded once", () => {
  const db = migrated();
  for (const c of SETTLE_COLUMNS) assert.ok(columns(db).includes(c), c);
  const ids = db.prepare(`SELECT id FROM _migrations WHERE id = 30`).all();
  assert.equal(ids.length, 1);
});

test("migration 30 runs twice without harm", () => {
  const db = migrated();
  unapply(db);
  quietly(() => runMigrations(db));
  db.exec(`DELETE FROM _migrations WHERE id = 30`);
  quietly(() => runMigrations(db));
  for (const c of SETTLE_COLUMNS) assert.ok(columns(db).includes(c), c);
});

test("migration 30 with some columns already there still adds the rest", () => {
  const db = migrated();
  unapply(db, ["settled_at", "pr_title"]);
  db.prepare(`INSERT INTO sessions (id, name) VALUES ('s', 's')`).run();
  quietly(() => runMigrations(db));
  for (const c of SETTLE_COLUMNS) assert.ok(columns(db).includes(c), c);
  const row = db
    .prepare(
      `SELECT settled_at, settled_reason, pr_merged_at FROM sessions WHERE id = 's'`
    )
    .get();
  assert.deepEqual(row, {
    settled_at: null,
    settled_reason: null,
    pr_merged_at: null,
  });
});
