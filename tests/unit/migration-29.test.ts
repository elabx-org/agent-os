import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";

const LIMIT_COLUMNS = [
  "limited_at",
  "limited_until",
  "limit_kind",
  "resume_policy",
  "resume_text",
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

/** Back to before migration 29 */
function unapply(db: Database.Database, keep: string[] = []) {
  for (const c of LIMIT_COLUMNS) {
    if (!keep.includes(c)) db.exec(`ALTER TABLE sessions DROP COLUMN ${c}`);
  }
  db.exec(`DELETE FROM _migrations WHERE id = 29`);
}

test("migration 29 adds the five limit columns, recorded once", () => {
  const db = migrated();
  for (const c of LIMIT_COLUMNS) assert.ok(columns(db).includes(c), c);
  const ids = db.prepare(`SELECT id FROM _migrations WHERE id = 29`).all();
  assert.equal(ids.length, 1);
});

test("migration 29 runs twice without harm", () => {
  const db = migrated();
  unapply(db);
  quietly(() => runMigrations(db));
  db.exec(`DELETE FROM _migrations WHERE id = 29`);
  quietly(() => runMigrations(db));
  for (const c of LIMIT_COLUMNS) assert.ok(columns(db).includes(c), c);
});

test("migration 29 with one column already there still adds the rest", () => {
  const db = migrated();
  unapply(db, ["limited_at"]);
  db.prepare(`INSERT INTO sessions (id, name) VALUES ('s', 's')`).run();
  quietly(() => runMigrations(db));
  for (const c of LIMIT_COLUMNS) assert.ok(columns(db).includes(c), c);
  const row = db
    .prepare(`SELECT limited_at, resume_policy FROM sessions WHERE id = 's'`)
    .get();
  assert.deepEqual(row, { limited_at: null, resume_policy: null });
});
