import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-store-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let store: typeof import("../../lib/backup/store");
let takeover: typeof import("../../lib/backup/takeover");
let taken: typeof import("../../lib/backup/taken");

const A = "m_00000000000a";
const B = "m_00000000000b";

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/backup/store");
  takeover = await import("../../lib/backup/takeover");
  taken = await import("../../lib/backup/taken");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  db.getDb().exec("DELETE FROM machine_backups");
  db.getDb().exec("DELETE FROM sessions");
});

function row(
  machine: string,
  session: string,
  extra: Partial<{
    state: string;
    take_id: string | null;
    machine_paused_at: number | null;
    orphan: number;
  }> = {}
) {
  db.getDb()
    .prepare(
      `INSERT INTO machine_backups (machine_id, session_id, machine_name, name,
         claude_session_id, manifest, copied_at, state, take_id,
         machine_paused_at, orphan)
       VALUES (?, ?, 'Mac', 'S', 'c', '{}', 1, ?, ?, ?, ?)`
    )
    .run(
      machine,
      session,
      extra.state ?? "current",
      extra.take_id ?? null,
      extra.machine_paused_at ?? null,
      extra.orphan ?? 0
    );
}

/** The hub's session continued from that take-over */
function hubSession(
  id: string,
  takeId: string,
  settledAt: number | null = null
) {
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, working_directory, moved_from, settled_at)
       VALUES (?, 'S', '/tmp', ?, ?)`
    )
    .run(
      id,
      JSON.stringify({ machine: A, name: "Mac", at: 1, takeId }),
      settledAt
    );
}

test("deleting copies skips a taken row the machine hasn't confirmed", async () => {
  row(A, "s1");
  row(A, "s2", { state: "taken", take_id: "a".repeat(16) });
  row(A, "s3", {
    state: "taken",
    take_id: "b".repeat(16),
    machine_paused_at: 5,
  });
  const removed = await store.deleteCopies(store.backupRows(A));
  assert.equal(removed, 2);
  assert.deepEqual(
    store.backupRows(A).map((r) => r.session_id),
    ["s2"]
  );
  assert.equal(store.copyTotals(A).unconfirmed, 1);
});

test("removing a machine keeps its unconfirmed take-overs as orphans for any machine", async () => {
  row(A, "s1");
  row(A, "s2", { state: "taken", take_id: "a".repeat(16) });
  hubSession("s2", "a".repeat(16));
  fs.mkdirSync(store.machineDir(A), { recursive: true });
  await store.forgetMachine(A);
  assert.ok(!fs.existsSync(store.machineDir(A)));
  const left = db
    .getDb()
    .prepare(`SELECT session_id, orphan FROM machine_backups`)
    .all();
  assert.deepEqual(left, [{ session_id: "s2", orphan: 1 }]);
  // The same Mac linked again under a new key is still told
  assert.deepEqual(
    taken.takenFor({ id: B }).map((t) => t.sessionId),
    ["s2"]
  );
  // Not in its list of copies, or its totals
  assert.equal(store.backupRows(B).length, 0);
  assert.equal(store.copyTotals(A).copies, 0);
});

test("removing a machine mid take-over keeps the row, so a finished take-over still pauses it", async () => {
  const take = "c".repeat(16);
  row(A, "s9", { state: "taking", take_id: take });
  hubSession("s9", take);
  await store.forgetMachine(A);
  assert.equal(store.backupRow(A, "s9")?.orphan, 1);
  // The take-over finishes as takeover.ts does it
  db.getDb()
    .prepare(
      `UPDATE machine_backups SET state = 'taken', taken_at = 1
       WHERE machine_id = ? AND session_id = ? AND take_id = ?`
    )
    .run(A, "s9", take);
  assert.deepEqual(
    taken.takenFor({ id: B }).map((t) => t.sessionId),
    ["s9"]
  );
});

test("an orphan stops going out once its session has moved on from here", async () => {
  const take = "d".repeat(16);
  row(A, "s7", { state: "taken", take_id: take, orphan: 1 });
  hubSession("s7", take, 5);
  db.getDb()
    .prepare(`UPDATE sessions SET moved_to = ? WHERE id = 's7'`)
    .run(JSON.stringify({ machine: B, name: "Other", at: 6 }));
  // Not to B, where it went, nor to a machine it went on to from there
  assert.deepEqual(taken.takenFor({ id: B }), []);
  assert.deepEqual(taken.takenFor({ id: "m_00000000000c" }), []);
});

test("the ack: only the tunnel's rows and orphans with the same take id change", () => {
  const take = "a".repeat(16);
  row(A, "s1", { state: "taken", take_id: take });
  row(B, "s2", { state: "taken", take_id: take });
  row(A, "s3", { state: "taken", take_id: take, orphan: 1 });
  const notes: string[] = [];
  const deps = {
    db: db.getDb(),
    now: () => 7,
    notify: (m: { title: string }) => notes.push(m.title),
  };
  taken.onTakenAck(
    { id: A, name: "Mac" },
    [
      {
        sessionId: "s1",
        takeId: take,
        state: "paused",
        ahead: { conversation: true, code: false },
      },
      { sessionId: "s2", takeId: take, state: "paused" },
      { sessionId: "s3", takeId: take, state: "gone" },
      { sessionId: "s1", takeId: "b".repeat(16), state: "paused" },
    ],
    deps
  );
  const paused = (m: string, s: string) =>
    (store.backupRow(m, s) as { machine_paused_at: number | null })
      .machine_paused_at;
  assert.equal(paused(A, "s1"), 7);
  // Another machine's row isn't this tunnel's to confirm
  assert.equal(paused(B, "s2"), null);
  // gone doesn't clear an orphan: it may be on another machine
  assert.equal(paused(A, "s3"), null);
  assert.deepEqual(notes, ['Mac did more on "S" after the copy']);
  assert.equal(JSON.parse(store.backupRow(A, "s1")!.ahead!).conversation, true);
});

test("no ack: it stays unconfirmed and is sent again", () => {
  row(A, "s1", { state: "taken", take_id: "a".repeat(16) });
  assert.equal(taken.takenFor({ id: A }).length, 1);
  taken.onTakenAck(
    { id: A, name: "Mac" },
    [{ sessionId: "s1", takeId: "a".repeat(16), state: "failed" }],
    { db: db.getDb(), now: () => 1, notify: () => {} }
  );
  assert.equal(taken.takenFor({ id: A }).length, 1);
  assert.equal(store.backupRow(A, "s1")!.machine_paused_at, null);
});

test("boot recovery of taking, both ways, by take id", () => {
  const take = "c".repeat(16);
  row(A, "s1", { state: "taking", take_id: take });
  row(A, "s2", { state: "taking", take_id: "d".repeat(16) });
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, working_directory, moved_from) VALUES ('s1', 'S', '/tmp', ?)`
    )
    .run(
      JSON.stringify({
        machine: A,
        name: "Mac",
        at: 1,
        takeId: take,
        copyAt: 1,
      })
    );
  assert.equal(takeover.recoverTakes(db.getDb()), 2);
  assert.equal(store.backupRow(A, "s1")!.state, "taken");
  const back = store.backupRow(A, "s2")!;
  assert.equal(back.state, "current");
  assert.equal(back.take_id, null);
});

test("a move elsewhere drops the copies of that session, not a taken one", async () => {
  row(A, "s1");
  row(B, "s1", { state: "taken", take_id: "a".repeat(16) });
  await store.dropOtherCopies("s1", null);
  assert.equal(store.backupRow(A, "s1"), null);
  assert.ok(store.backupRow(B, "s1"));
});

test("a copy being continued here is never deleted", async () => {
  row(A, "s1", { state: "taking", take_id: "a".repeat(16) });
  row(A, "s2");
  assert.equal(await store.deleteCopies(store.backupRows(A)), 1);
  assert.equal(await store.dropOtherCopies("s1", B), 0);
  assert.deepEqual(
    store.backupRows(A).map((r) => r.session_id),
    ["s1"]
  );
});

test("taken: a session brought back to that machine is not paused again", () => {
  const take = "a".repeat(16);
  row(A, "s1", { state: "taken", take_id: take });
  row(A, "s2", { state: "taken", take_id: "b".repeat(16) });
  const insert = db.getDb().prepare(
    `INSERT INTO sessions (id, name, working_directory, settled_at, moved_to)
       VALUES (?, 'S', '/tmp', ?, ?)`
  );
  // s1 went back to A ("Bring it back"); s2 runs here
  insert.run("s1", 5, JSON.stringify({ machine: A, name: "Mac", at: 5 }));
  insert.run("s2", null, null);
  assert.deepEqual(
    taken.takenFor({ id: A }).map((t) => t.sessionId),
    ["s2"]
  );
  // To another machine it is still paused here
  insert.run("s3", 5, JSON.stringify({ machine: B, name: "Other", at: 5 }));
  row(A, "s3", { state: "taken", take_id: "c".repeat(16) });
  assert.deepEqual(
    taken
      .takenFor({ id: A })
      .map((t) => t.sessionId)
      .sort(),
    ["s2", "s3"]
  );
});
