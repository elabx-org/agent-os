import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { BackupDeps } from "../../lib/backup/machine";
import type { UpInit } from "../../lib/link/machine";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-mac-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let machine: typeof import("../../lib/backup/machine");

const SID = "sess-1";
const CLAUDE = "0b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
const REPO = path.join(tmp, "work");
const CONVO = path.join(tmp, "convo.jsonl");

before(async () => {
  db = await import("../../lib/db");
  machine = await import("../../lib/backup/machine");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sh = (args: string[]) =>
  execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();

beforeEach(() => {
  db.getDb().exec("DELETE FROM sessions");
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, working_directory, claude_session_id) VALUES (?, 'Fix login', ?, ?)`
    )
    .run(SID, REPO, CLAUDE);
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.mkdirSync(REPO, { recursive: true });
  sh(["init", "-q", "-b", "main"]);
  sh(["config", "user.email", "t@example.com"]);
  sh(["config", "user.name", "T"]);
  fs.writeFileSync(path.join(REPO, "a.txt"), "one\n");
  sh(["add", "a.txt"]);
  sh(["commit", "-q", "-m", "first"]);
  fs.writeFileSync(CONVO, '{"a":1}\n{"b":2}\n');
});

const row = () =>
  db.getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(SID) as Session;

/** A hub that answers begin with `plan` and records what came */
function hub(
  plan: Partial<{
    head: string | null;
    snapshot: string | null;
    offset: number;
  }>,
  over: Partial<BackupDeps> = {}
) {
  const calls: UpInit[] = [];
  const ok = (body: unknown) => ({
    status: 200,
    headers: {},
    body: Buffer.from(JSON.stringify(body)),
  });
  const deps: BackupDeps = {
    upload: async (init) => {
      calls.push(init);
      if (init.path.endsWith("/begin")) {
        return ok({
          backupId: "0123456789abcdef",
          offset: 0,
          tail: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          head: null,
          snapshot: null,
          have: [],
          ...plan,
        });
      }
      // Read a streamed body to its end, as the link would
      const body = init.body as NodeJS.ReadableStream | Buffer | undefined;
      if (body && !Buffer.isBuffer(body)) {
        for await (const chunk of body) void chunk;
      }
      return ok({});
    },
    idle: async () => true,
    locate: async () => ({ sessionId: CLAUDE, file: CONVO }),
    pause: async () => [],
    tmpdir: () => tmp,
    ...over,
  };
  return { deps, calls };
}

const kinds = (calls: UpInit[]) =>
  calls.map((c) => `${c.method} ${c.path.split("/").pop()!.split("?")[0]}`);

test("a turn started mid-copy drops the run before anything is sent", async () => {
  const { deps, calls } = hub({}, { idle: async () => false });
  const record = { key: "k", sessions: {} };
  assert.equal(await machine.backupOne(row(), record, deps), "dropped");
  assert.deepEqual(calls, []);
});

test("code is sent when the hub's SHAs differ, and not when they match", async () => {
  const head = sh(["rev-parse", "HEAD"]);
  const first = hub({ head: null });
  const record = { key: "k", sessions: {} as Record<string, never> };
  assert.equal(await machine.backupOne(row(), record, first.deps), "copied");
  assert.deepEqual(kinds(first.calls), [
    "POST begin",
    "PUT bundle",
    "PUT file",
    "POST commit",
  ]);
  // The hub already has this HEAD: only the conversation's new bytes
  fs.appendFileSync(CONVO, '{"c":3}\n');
  // Its tail at 16 matches: the hub's tail hash is asked from the file
  const { tailHash } = await import("../../lib/backup/delta");
  const tail = await tailHash(CONVO, 16);
  const third = hub({ head, offset: 16, ...{ tail } } as never);
  assert.equal(await machine.backupOne(row(), record, third.deps), "copied");
  assert.deepEqual(kinds(third.calls), [
    "POST begin",
    "PUT file",
    "POST commit",
  ]);
  assert.match(third.calls[1].path, /offset=16&reset=0$/);
});

test("the local record is wiped for another hub or machine id", () => {
  const file = path.join(tmp, "state.json");
  machine.writeBackupState(
    {
      key: "hub.example|m_00000000000a",
      sessions: {
        [SID]: {
          claudeSessionId: CLAUDE,
          bytes: 5,
          head: null,
          snapshot: null,
          sig: "s",
        },
      },
    },
    file
  );
  assert.equal(
    Object.keys(
      machine.readBackupState("hub.example|m_00000000000a", file).sessions
    ).length,
    1
  );
  assert.deepEqual(
    machine.readBackupState("hub.example|m_00000000000b", file).sessions,
    {}
  );
});

test("only a Claude session nobody else has may be copied", () => {
  assert.equal(machine.eligible(row()), true);
  assert.equal(
    machine.eligible({ ...row(), agent_type: "codex" } as Session),
    false
  );
  assert.equal(
    machine.eligible({ ...row(), moved_to: '{"machine":"hub"}' } as Session),
    false
  );
});
