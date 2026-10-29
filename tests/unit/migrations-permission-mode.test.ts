import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "@/lib/db/schema";
import { addColumnIfMissing, runMigrations } from "@/lib/db/migrations";

function freshDb() {
  const db = new Database(":memory:");
  createSchema(db);
  runMigrations(db);
  return db;
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );

function insertSession(
  db: Database.Database,
  id: string,
  autoApprove: number,
  mode: string | null = null
) {
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, auto_approve) VALUES (?, ?, ?, ?)`
  ).run(id, id, `claude-${id}`, autoApprove);
  db.prepare(`UPDATE sessions SET permission_mode = ? WHERE id = ?`).run(
    mode,
    id
  );
}

/** Forgets 22 and 23 as if they'd never run, keeping whatever they added */
function forget(db: Database.Database) {
  db.exec(`DELETE FROM _migrations WHERE id IN (22, 23)`);
}

const applied = (db: Database.Database) =>
  (
    db.prepare(`SELECT id FROM _migrations WHERE id IN (22, 23)`).all() as {
      id: number;
    }[]
  ).map((r) => r.id);

const modeOf = (db: Database.Database, id: string) =>
  (
    db.prepare(`SELECT permission_mode FROM sessions WHERE id = ?`).get(id) as {
      permission_mode: string | null;
    }
  ).permission_mode;

test("addColumnIfMissing adds once", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE t (a TEXT)`);
  addColumnIfMissing(db, "t", "b", "TEXT");
  addColumnIfMissing(db, "t", "b", "TEXT");
  assert.deepEqual(columns(db, "t"), ["a", "b"]);
});

test("migrations 22 and 23 on a fresh DB", () => {
  const db = freshDb();
  for (const c of ["permission_mode", "permission_pending", "launch_caps"]) {
    assert.ok(columns(db, "sessions").includes(c), c);
  }
  assert.ok(columns(db, "agent_actions").includes("target_session_id"));
  assert.deepEqual(applied(db).sort(), [22, 23]);
});

test("migration 22 run twice backfills and keeps chosen modes", () => {
  const db = freshDb();
  insertSession(db, "full", 1);
  insertSession(db, "chosen", 1, "auto");
  insertSession(db, "plain", 0);
  forget(db);
  runMigrations(db);
  forget(db);
  runMigrations(db);
  assert.deepEqual(applied(db).sort(), [22, 23]);
  assert.equal(modeOf(db, "full"), "bypassPermissions");
  assert.equal(modeOf(db, "chosen"), "auto");
  assert.equal(modeOf(db, "plain"), null);
  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_actions'`
    )
    .all() as { name: string }[];
  assert.ok(indexes.some((i) => i.name === "idx_agent_actions_target"));
});

test("migration 22 on a DB that already has permission_mode", () => {
  const db = freshDb();
  // Only the first column made it (an old build, or a half-applied run)
  db.exec(`ALTER TABLE sessions DROP COLUMN permission_pending`);
  db.exec(`ALTER TABLE sessions DROP COLUMN launch_caps`);
  db.exec(`DROP TABLE agent_actions`);
  insertSession(db, "full", 1);
  forget(db);
  runMigrations(db);
  // The early column didn't skip the rest
  assert.ok(columns(db, "sessions").includes("permission_pending"));
  assert.ok(columns(db, "sessions").includes("launch_caps"));
  assert.ok(columns(db, "agent_actions").length > 0);
  assert.equal(modeOf(db, "full"), "bypassPermissions");
  assert.deepEqual(applied(db).sort(), [22, 23]);
});
