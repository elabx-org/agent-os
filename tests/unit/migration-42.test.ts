import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";

function migrated(): Database.Database {
  const db = new Database(":memory:");
  createSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    runMigrations(db);
  } finally {
    console.log = log;
  }
  return db;
}

test("migration 42 adds machine_backups, one row per machine and session", () => {
  const db = migrated();
  const columns = (
    db.prepare(`PRAGMA table_info(machine_backups)`).all() as {
      name: string;
    }[]
  ).map((c) => c.name);
  for (const name of [
    "machine_id",
    "session_id",
    "claude_session_id",
    "manifest",
    "repo_key",
    "head",
    "snapshot_commit",
    "snapshot_tree",
    "file_gen",
    "file_bytes",
    "has_settings",
    "copied_at",
    "state",
    "take_id",
    "taken_at",
    "machine_paused_at",
    "ahead",
    "orphan",
  ]) {
    assert.ok(columns.includes(name), name);
  }
  const insert = db.prepare(
    `INSERT INTO machine_backups (machine_id, session_id, machine_name, name,
       claude_session_id, manifest, copied_at) VALUES (?, ?, 'Mac', 'S', 'c', '{}', 1)`
  );
  insert.run("m_000000000001", "s1");
  assert.throws(() => insert.run("m_000000000001", "s1"));
  insert.run("m_000000000002", "s1");
  const row = db
    .prepare(`SELECT state, orphan, file_gen FROM machine_backups LIMIT 1`)
    .get();
  assert.deepEqual(row, { state: "current", orphan: 0, file_gen: 0 });
});

test("migration 42 runs twice without harm", () => {
  const db = migrated();
  db.exec(`DELETE FROM _migrations WHERE id = 42`);
  const log = console.log;
  console.log = () => {};
  try {
    runMigrations(db);
  } finally {
    console.log = log;
  }
  assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM machine_backups`).get());
});
