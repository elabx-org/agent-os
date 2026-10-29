import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createSchema } from "../../lib/db/schema";
import { addColumnIfMissing, runMigrations } from "../../lib/db/migrations";

const NEW_COLUMNS = ["permission_mode", "permission_pending", "launch_caps"];

/** A database as the server leaves it at start */
function migrated(): Database.Database {
  const db = new Database(":memory:");
  createSchema(db);
  quietly(() => runMigrations(db));
  return db;
}

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

const applied = (db: Database.Database) =>
  (db.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map(
    (r) => r.id
  );

const indexes = (db: Database.Database, table: string) =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`
      )
      .all(table) as { name: string }[]
  ).map((r) => r.name);

function addSession(
  db: Database.Database,
  id: string,
  autoApprove: number,
  mode: string | null = null,
  agentType = "claude"
) {
  db.prepare(
    `INSERT INTO sessions (id, name, auto_approve, agent_type) VALUES (?, ?, ?, ?)`
  ).run(id, id, autoApprove, agentType);
  if (mode) {
    db.prepare(`UPDATE sessions SET permission_mode = ? WHERE id = ?`).run(
      mode,
      id
    );
  }
}

const modeOf = (db: Database.Database, id: string) =>
  (
    db.prepare(`SELECT permission_mode FROM sessions WHERE id = ?`).get(id) as {
      permission_mode: string | null;
    }
  ).permission_mode;

/** Back to before migrations 22 and 23, keeping the sessions */
function unapply(db: Database.Database, drop: string[] = NEW_COLUMNS) {
  for (const column of drop) {
    db.exec(`ALTER TABLE sessions DROP COLUMN ${column}`);
  }
  db.exec(`DELETE FROM _migrations WHERE id IN (22, 23)`);
}

describe("addColumnIfMissing", () => {
  test("adds a column once and is a no-op after", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
    addColumnIfMissing(db, "t", "extra", "TEXT");
    addColumnIfMissing(db, "t", "extra", "TEXT");
    assert.deepEqual(columns(db, "t"), ["id", "extra"]);
  });
});

describe("migrations 22 and 23", () => {
  test("apply on a fresh database", () => {
    const db = migrated();
    for (const c of NEW_COLUMNS) assert.ok(columns(db, "sessions").includes(c));
    assert.deepEqual(columns(db, "agent_actions"), [
      "id",
      "actor_session_id",
      "actor_tmux",
      "target_session_id",
      "action",
      "allowed",
      "detail",
      "at",
    ]);
    assert.ok(
      indexes(db, "agent_actions").includes("idx_agent_actions_target")
    );
    assert.ok(applied(db).includes(22));
    assert.ok(applied(db).includes(23));
  });

  test("backfill full access from auto_approve on an older database", () => {
    const db = migrated();
    db.exec(`DROP TABLE agent_actions`);
    unapply(db);
    addSession(db, "yolo", 1);
    addSession(db, "plain", 0);
    addSession(db, "codex", 1, null, "codex");
    addSession(db, "gemini", 1, null, "gemini");
    quietly(() => runMigrations(db));
    assert.equal(modeOf(db, "yolo"), "bypassPermissions");
    assert.equal(modeOf(db, "plain"), null);
    // Codex's auto-approve is the sandboxed --full-auto: it stays that
    assert.equal(modeOf(db, "codex"), "auto");
    assert.equal(modeOf(db, "gemini"), "bypassPermissions");
    assert.ok(applied(db).includes(22));
    assert.ok(applied(db).includes(23));
  });

  test("run twice: everything applied, nothing duplicated", () => {
    const db = migrated();
    addSession(db, "yolo", 1);
    db.exec(`DELETE FROM _migrations WHERE id IN (22, 23)`);
    quietly(() => runMigrations(db));
    db.exec(`DELETE FROM _migrations WHERE id IN (22, 23)`);
    quietly(() => runMigrations(db));
    assert.equal(
      columns(db, "sessions").filter((c) => NEW_COLUMNS.includes(c)).length,
      3
    );
    assert.equal(
      indexes(db, "agent_actions").filter(
        (n) => n === "idx_agent_actions_target"
      ).length,
      1
    );
    assert.equal(modeOf(db, "yolo"), "bypassPermissions");
    assert.ok(applied(db).includes(22));
  });

  test("with permission_mode already there, still adds the rest", () => {
    // The old runner would have stopped at "duplicate column" and recorded
    // the migration with permission_pending and launch_caps missing
    const db = migrated();
    unapply(db, ["permission_pending", "launch_caps"]);
    addSession(db, "yolo", 1);
    addSession(db, "chosen", 1, "auto");
    quietly(() => runMigrations(db));
    for (const c of NEW_COLUMNS) assert.ok(columns(db, "sessions").includes(c));
    assert.equal(modeOf(db, "yolo"), "bypassPermissions");
    assert.equal(modeOf(db, "chosen"), "auto", "a set mode is left alone");
    assert.ok(applied(db).includes(22));
  });
});

describe("scripts/migrate-only.mjs", () => {
  const script = path.join(__dirname, "../../scripts/migrate-only.mjs");

  test("migrates a database file and exits", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mig-"));
    try {
      const file = path.join(tmp, "copy.db");
      new Database(file).close();
      const out = execFileSync(process.execPath, [script, file], {
        encoding: "utf8",
      });
      assert.match(out, /migrated, latest migration \d+/);
      const db = new Database(file, { readonly: true });
      assert.ok(columns(db, "sessions").includes("permission_mode"));
      db.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("refuses a database under ~/.agent-os", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-home-"));
    try {
      const file = path.join(home, ".agent-os", "agent-os.db");
      fs.mkdirSync(path.dirname(file));
      fs.writeFileSync(file, "");
      assert.throws(
        () =>
          execFileSync(process.execPath, [script, file], {
            env: { ...process.env, HOME: home },
            stdio: "pipe",
          }),
        (error: { status?: number; stderr?: Buffer }) =>
          error.status === 2 && /Refusing/.test(String(error.stderr))
      );
      assert.equal(fs.statSync(file).size, 0, "left untouched");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("migration 24", () => {
  const unapply24 = (db: Database.Database, drop: string[]) => {
    for (const column of drop)
      db.exec(`ALTER TABLE projects DROP COLUMN ${column}`);
    db.exec(`DELETE FROM _migrations WHERE id = 24`);
  };

  test("adds pinned (default 0) and group_name to projects", () => {
    const db = migrated();
    assert.ok(columns(db, "projects").includes("pinned"));
    assert.ok(columns(db, "projects").includes("group_name"));
    assert.ok(applied(db).includes(24));
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('p', 'p', '/tmp')`
    ).run();
    assert.deepEqual(
      db
        .prepare(`SELECT pinned, group_name FROM projects WHERE id = 'p'`)
        .get(),
      { pinned: 0, group_name: null }
    );
  });

  test("runs twice, and over a database with one column already there", () => {
    const db = migrated();
    unapply24(db, ["group_name"]);
    quietly(() => runMigrations(db));
    assert.ok(columns(db, "projects").includes("group_name"));
    unapply24(db, []);
    quietly(() => runMigrations(db));
    assert.ok(applied(db).includes(24));
  });
});

describe("migrations 25 and 26", () => {
  const QUEUE = [
    "id",
    "session_id",
    "position",
    "text",
    "attachments",
    "origin",
    "kind",
    "status",
    "not_before",
    "created_at",
    "sent_at",
    "error",
  ];
  const TURNS = [
    "id",
    "session_id",
    "turn_no",
    "cwd",
    "prompt_excerpt",
    "transcript_uuid",
    "pre_ref",
    "post_ref",
    "started_at",
    "ended_at",
    "files_json",
    "touched_json",
    "added",
    "removed",
    "undone_at",
  ];

  test("create session_queue and session_turns", () => {
    const db = migrated();
    assert.deepEqual(columns(db, "session_queue"), QUEUE);
    assert.deepEqual(columns(db, "session_turns"), TURNS);
    assert.ok(indexes(db, "session_queue").includes("idx_queue_session"));
    assert.ok(applied(db).includes(25));
    assert.ok(applied(db).includes(26));
    db.prepare(
      `INSERT INTO session_queue (session_id, position, text, created_at) VALUES ('s', 1, 'hi', 0)`
    ).run();
    assert.deepEqual(
      db.prepare(`SELECT origin, kind, status FROM session_queue`).get(),
      { origin: "user", kind: "message", status: "pending" }
    );
    const turn = db.prepare(
      `INSERT INTO session_turns (session_id, turn_no, cwd) VALUES ('s', 1, '/tmp')`
    );
    turn.run();
    assert.throws(() => turn.run(), /UNIQUE/);
  });

  test("run twice: applied, nothing duplicated, rows kept", () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO session_queue (session_id, position, text, created_at) VALUES ('s', 1, 'hi', 0)`
    ).run();
    db.exec(`DELETE FROM _migrations WHERE id IN (25, 26)`);
    quietly(() => runMigrations(db));
    assert.ok(applied(db).includes(25));
    assert.ok(applied(db).includes(26));
    assert.equal(
      indexes(db, "session_queue").filter((n) => n === "idx_queue_session")
        .length,
      1
    );
    assert.equal(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM session_queue`).get() as {
          n: number;
        }
      ).n,
      1
    );
  });

  test("an older database without either table gets both", () => {
    const db = migrated();
    db.exec(`DROP TABLE session_queue`);
    db.exec(`DROP TABLE session_turns`);
    db.exec(`DELETE FROM _migrations WHERE id IN (25, 26)`);
    quietly(() => runMigrations(db));
    assert.deepEqual(columns(db, "session_queue"), QUEUE);
    assert.deepEqual(columns(db, "session_turns"), TURNS);
  });
});
