import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { runMigrations } from "../../lib/db/migrations";
import {
  lastRefused,
  listMachineActions,
  recordMachineAction,
  type NewMachineAction,
} from "../../lib/link/machine-actions";

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

const row = (over: Partial<NewMachineAction> = {}): NewMachineAction => ({
  machine_id: "m_000000000001",
  machine_name: "Mac",
  action: "start",
  target_session_id: "s1",
  target_name: "Fix it",
  target_machine_id: null,
  detail: "x".repeat(300),
  allowed: 1,
  ...over,
});

test("machine actions: recorded, clipped, newest first", () => {
  const db = migrated();
  recordMachineAction(row({ at: 1000 }), db);
  recordMachineAction(row({ action: "message", at: 2000 }), db);
  recordMachineAction(row({ machine_id: "m_000000000002", at: 3000 }), db);
  const list = listMachineActions("m_000000000001", 50, db);
  assert.deepEqual(
    list.map((a) => a.action),
    ["message", "start"]
  );
  assert.equal(list[0].detail?.length, 200);
  assert.equal(listMachineActions("m_000000000001", 1, db).length, 1);
});

test("machine actions: older than 30 days and past 500 per machine are pruned", () => {
  const db = migrated();
  const now = 100 * 86400_000;
  recordMachineAction(row({ at: now - 31 * 86400_000 }), db);
  recordMachineAction(row({ at: now }), db);
  assert.equal(listMachineActions("m_000000000001", 500, db).length, 1);
  for (let i = 0; i < 510; i++) recordMachineAction(row({ at: now + i }), db);
  const kept = listMachineActions("m_000000000001", 500, db);
  assert.equal(kept.length, 500);
  assert.equal(kept[0].at, now + 509);
});

test("machine actions: the last refusal for a reason", () => {
  const db = migrated();
  assert.equal(lastRefused("m_000000000001", "off", db), null);
  recordMachineAction(
    row({ action: "refused", detail: "off", allowed: 0, at: 7 }),
    db
  );
  assert.equal(lastRefused("m_000000000001", "off", db), 7);
});

test("migration 41: started_by and machine_actions", () => {
  const db = migrated();
  const cols = (
    db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
  ).map((c) => c.name);
  assert.ok(cols.includes("started_by"));
  const index = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_machine_actions_machine'`
    )
    .get();
  assert.ok(index);
  db.exec(`DELETE FROM _migrations WHERE id = 41`);
  const log = console.log;
  console.log = () => {};
  try {
    runMigrations(db);
  } finally {
    console.log = log;
  }
  assert.deepEqual(
    db.prepare(`SELECT COUNT(*) AS n FROM _migrations WHERE id = 41`).get(),
    { n: 1 }
  );
});
