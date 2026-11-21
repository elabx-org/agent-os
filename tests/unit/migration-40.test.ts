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

const column = (db: Database.Database, name: string) =>
  (
    db.prepare(`PRAGMA table_info(machines)`).all() as {
      name: string;
      dflt_value: string | null;
      notnull: number;
    }[]
  ).find((c) => c.name === name);

test("migration 40 adds uses_hub, backup and caps to machines", () => {
  const db = migrated();
  assert.equal(column(db, "uses_hub")?.dflt_value, "0");
  assert.equal(column(db, "uses_hub")?.notnull, 1);
  assert.equal(column(db, "backup")?.dflt_value, "0");
  assert.equal(column(db, "caps")?.notnull, 0);
  db.prepare(
    `INSERT INTO machines (id, name, public_key, created_at) VALUES ('m_1', 'Mac', 'k', 1)`
  ).run();
  assert.deepEqual(
    db.prepare(`SELECT uses_hub, backup, caps FROM machines`).get(),
    { uses_hub: 0, backup: 0, caps: null }
  );
});

test("migration 40 runs twice without harm", () => {
  const db = migrated();
  db.exec(`DELETE FROM _migrations WHERE id = 40`);
  quietly(() => runMigrations(db));
  assert.ok(column(db, "caps"));
  assert.deepEqual(
    db.prepare(`SELECT COUNT(*) AS n FROM _migrations WHERE id = 40`).get(),
    { n: 1 }
  );
});
