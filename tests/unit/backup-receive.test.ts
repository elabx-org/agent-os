import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { MachineRow } from "../../lib/link/store";
import type { BackupManifest, BackupPlan } from "../../lib/backup/types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-recv-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
// This disk's free space isn't what these tests are about
process.env.AGENTOS_BACKUP_MIN_FREE_BYTES = "0";

let db: typeof import("../../lib/db");
let recv: typeof import("../../lib/backup/receive");
let store: typeof import("../../lib/backup/store");
let move: typeof import("../../lib/session-move");
let wt: typeof import("../../lib/worktree-move-git");

const A = "m_00000000000a";
const B = "m_00000000000b";
const SID = "sess-1";
const CLAUDE = "0b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
const REPO = path.join(tmp, "work");

before(async () => {
  db = await import("../../lib/db");
  recv = await import("../../lib/backup/receive");
  store = await import("../../lib/backup/store");
  move = await import("../../lib/session-move");
  wt = await import("../../lib/worktree-move-git");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sh = (args: string[], cwd = REPO) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function machine(id: string): MachineRow {
  return {
    id,
    name: id === A ? "Mac" : "Other",
    public_key: `k-${id}`,
    status: "approved",
    platform: "darwin",
    sha: null,
    signed_in_as: null,
    created_at: 1,
    approved_at: 1,
    last_seen: null,
    agents: 0,
    uses_hub: 0,
    backup: 1,
    caps: null,
  };
}

beforeEach(() => {
  const d = db.getDb();
  d.exec("DELETE FROM machine_backups");
  d.exec("DELETE FROM sessions");
  fs.rmSync(path.join(tmp, "home"), { recursive: true, force: true });
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.mkdirSync(REPO, { recursive: true });
  sh(["init", "-q", "-b", "main"]);
  sh(["config", "user.email", "t@example.com"]);
  sh(["config", "user.name", "T"]);
  fs.writeFileSync(path.join(REPO, "a.txt"), "one\n");
  sh(["add", "a.txt"]);
  sh(["commit", "-q", "-m", "first"]);
});

const web = (data: Buffer | string) =>
  Readable.toWeb(
    Readable.from([Buffer.from(data)])
  ) as unknown as ReadableStream<Uint8Array>;
const webFile = (file: string) =>
  Readable.toWeb(
    fs.createReadStream(file)
  ) as unknown as ReadableStream<Uint8Array>;

async function code(sid = SID) {
  const head = sh(["rev-parse", "HEAD"]);
  sh(["update-ref", `refs/agent-os/${sid}/backup-head`, head]);
  const first = sh(["rev-list", "--max-parents=0", "HEAD"]);
  const snapshot = await wt.snapshotForMove(REPO, sid, {
    ref: `refs/agent-os/${sid}/backup`,
    label: `backup-${sid}`,
  });
  return { head, first, snapshot };
}

function manifest(
  sid: string,
  head: string,
  snapshot: BackupManifest["snapshot"],
  bytes: number,
  claude = CLAUDE
): BackupManifest {
  return {
    v: 1,
    sessionId: sid,
    name: "Fix login",
    claudeSessionId: claude,
    model: "sonnet",
    modelPinned: false,
    effort: null,
    permissionMode: "default",
    autoApprove: false,
    subagentModel: null,
    subagentOwnFirst: false,
    systemPrompt: null,
    repo: { name: "work", remote: null, head, branch: "main", subdir: "" },
    snapshot,
    projectName: "Work",
    lastActiveAt: 5,
    transcriptBytes: bytes,
  };
}

/** One whole copy, as the machine sends it */
async function copyOnce(
  m: MachineRow,
  conversation: Buffer,
  opts: { sid?: string; claude?: string; noBundle?: boolean } = {}
) {
  const sid = opts.sid ?? SID;
  const claude = opts.claude ?? CLAUDE;
  const { head, first, snapshot } = await code(sid);
  const plan: BackupPlan = await recv.beginBackup(m, sid, {
    v: 1,
    claudeSessionId: claude,
    repo: { name: "work", remote: null, first },
    transcriptBytes: conversation.length,
  });
  if (!opts.noBundle) {
    const bundle = path.join(tmp, `b-${plan.backupId}.bundle`);
    const made = await move.packBundle(
      REPO,
      [
        `refs/agent-os/${sid}/backup-head`,
        ...(snapshot ? [`refs/agent-os/${sid}/backup`] : []),
      ],
      plan.have,
      bundle
    );
    if (made) {
      await recv.receiveBundle(m, sid, plan.backupId, webFile(made));
      fs.rmSync(made, { force: true });
    }
  }
  const from = plan.offset <= conversation.length ? plan.offset : 0;
  await recv.receiveFile(
    m,
    sid,
    { backup: plan.backupId, offset: String(from), reset: "0" },
    web(conversation.subarray(from))
  );
  await recv.commitBackup(m, sid, {
    backupId: plan.backupId,
    manifest: manifest(sid, head, snapshot, conversation.length, claude),
  });
  return { plan, head, snapshot };
}

const code409 = async (fn: () => Promise<unknown>, code: string) => {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(error instanceof recv.BackupError, String(error));
    assert.equal(error.code, code);
    return true;
  });
};

test("a copy round trip: conversation byte for byte, HEAD, and uncommitted work", async () => {
  const m = machine(A);
  fs.writeFileSync(path.join(REPO, "a.txt"), "edited\n");
  fs.writeFileSync(path.join(REPO, "new.txt"), "untracked\n");
  sh(["commit", "-q", "--allow-empty", "-m", "unpushed"]);
  const convo = Buffer.from('{"a":1}\n{"b":2}\n');
  const { head, snapshot } = await copyOnce(m, convo);
  const row = store.backupRow(A, SID)!;
  assert.equal(row.state, "current");
  assert.equal(row.head, head);
  assert.equal(row.snapshot_commit, snapshot!.commit);
  assert.equal(row.file_bytes, convo.length);
  assert.deepEqual(
    fs.readFileSync(store.conversationFile(A, SID, row.file_gen)),
    convo
  );
  const repo = store.repoDir(A, row.repo_key!);
  const show = (p: string) =>
    execFileSync("git", ["show", `${snapshot!.commit}:${p}`], {
      cwd: repo,
      encoding: "utf8",
    });
  assert.equal(show("a.txt"), "edited\n");
  assert.equal(show("new.txt"), "untracked\n");

  // A second turn sends only the new bytes
  const more = Buffer.concat([convo, Buffer.from('{"c":3}\n')]);
  const second = await copyOnce(m, more);
  assert.equal(second.plan.offset, convo.length);
  assert.equal(second.plan.head, head);
  assert.deepEqual(
    fs.readFileSync(store.conversationFile(A, SID, row.file_gen)),
    more
  );
});

test("a crash before commit: begin truncates, drops incoming, and the old id is stale", async () => {
  const m = machine(A);
  const convo = Buffer.from('{"a":1}\n');
  await copyOnce(m, convo);
  const row = store.backupRow(A, SID)!;
  const live = store.conversationFile(A, SID, row.file_gen);
  const { first } = await code();
  const plan = await recv.beginBackup(m, SID, {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: 20,
  });
  // As if a commit died half-way through its append
  fs.appendFileSync(live, "half");
  const again = await recv.beginBackup(m, SID, {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: 20,
  });
  assert.equal(fs.statSync(live).size, convo.length);
  assert.notEqual(again.backupId, plan.backupId);
  await code409(
    () =>
      recv.receiveFile(
        m,
        SID,
        { backup: plan.backupId, offset: String(convo.length), reset: "0" },
        web("x\n")
      ),
    "stale"
  );
});

test("a reset writes a new generation; the row switches only at commit", async () => {
  const m = machine(A);
  await copyOnce(m, Buffer.from('{"a":1}\n'));
  const before = store.backupRow(A, SID)!;
  const { head, first, snapshot } = await code();
  const fresh = Buffer.from('{"z":9}\n');
  const plan = await recv.beginBackup(m, SID, {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: fresh.length,
  });
  await recv.receiveFile(
    m,
    SID,
    { backup: plan.backupId, offset: "0", reset: "1" },
    web(fresh)
  );
  assert.equal(store.backupRow(A, SID)!.file_gen, before.file_gen);
  await recv.commitBackup(m, SID, {
    backupId: plan.backupId,
    manifest: manifest(SID, head, snapshot, fresh.length),
  });
  const now = store.backupRow(A, SID)!;
  assert.equal(now.file_gen, before.file_gen + 1);
  assert.deepEqual(
    fs.readFileSync(store.conversationFile(A, SID, now.file_gen)),
    fresh
  );
  assert.ok(!fs.existsSync(store.conversationFile(A, SID, before.file_gen)));
});

test("a changed Claude id starts the conversation over", async () => {
  const m = machine(A);
  await copyOnce(m, Buffer.from('{"a":1}\n'));
  const other = "1b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
  const { plan } = await copyOnce(m, Buffer.from('{"b":1}\n'), {
    claude: other,
  });
  assert.equal(plan.offset, 0);
  const row = store.backupRow(A, SID)!;
  assert.equal(row.claude_session_id, other);
  assert.equal(
    fs.readFileSync(store.conversationFile(A, SID, row.file_gen), "utf8"),
    '{"b":1}\n'
  );
});

test("an offset that isn't where the copy ends is refused", async () => {
  const m = machine(A);
  await copyOnce(m, Buffer.from('{"a":1}\n'));
  const { first } = await code();
  const plan = await recv.beginBackup(m, SID, {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: 30,
  });
  await code409(
    () =>
      recv.receiveFile(
        m,
        SID,
        { backup: plan.backupId, offset: "3", reset: "0" },
        web("x\n")
      ),
    "mismatch"
  );
});

test("caps: too large a conversation, and too many sessions", async () => {
  const m = machine(A);
  const { first } = await code();
  await code409(
    () =>
      recv.beginBackup(m, SID, {
        v: 1,
        claudeSessionId: CLAUDE,
        repo: { name: "work", remote: null, first },
        transcriptBytes: store.BACKUP_LIMITS.conversation + 1,
      }),
    "too_large"
  );
  // A machine at its 2,000 sessions: a new one is refused, an old one isn't
  await copyOnce(m, Buffer.from('{"a":1}\n'));
  const insert = db.getDb().prepare(
    `INSERT INTO machine_backups (machine_id, session_id, machine_name, name,
         claude_session_id, manifest, copied_at) VALUES (?, ?, 'Mac', 'S', ?, '{}', 1)`
  );
  for (let i = 1; i < 2000; i++) insert.run(A, `filler-${i}`, CLAUDE);
  await code409(() => copyOnce(m, Buffer.from("x\n"), { sid: "s2" }), "full");
  await copyOnce(m, Buffer.from('{"a":1}\n{"b":2}\n'));
});

test("taken: whenever this server has that session, until it moved back to the caller", async () => {
  const m = machine(A);
  const d = db.getDb();
  d.prepare(
    `INSERT INTO sessions (id, name, working_directory) VALUES (?, 'S', '/tmp')`
  ).run(SID);
  const { first } = await code();
  const begin = {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: 1,
  };
  await assert.rejects(
    () => recv.beginBackup(m, SID, begin),
    (error: unknown) => {
      assert.ok(error instanceof recv.BackupError);
      assert.equal(error.code, "taken");
      assert.equal(error.status, 409);
      const taken = (error.body() as Record<string, unknown>).taken as {
        sessionId: string;
        hubName: string;
      };
      assert.equal(taken.sessionId, SID);
      assert.equal(typeof taken.hubName, "string");
      return true;
    }
  );
  // Settled here and moved to another machine: still the hub's to hold
  d.prepare(
    `UPDATE sessions SET settled_at = 1, settled_reason = 'moved', moved_to = ? WHERE id = ?`
  ).run(
    JSON.stringify({
      machine: B,
      name: "Other",
      at: 1,
      head: "",
      branch: null,
      snapshot: null,
    }),
    SID
  );
  await code409(() => recv.beginBackup(m, SID, begin), "taken");
  // Moved back to the caller: copies start again
  d.prepare(`UPDATE sessions SET moved_to = ? WHERE id = ?`).run(
    JSON.stringify({
      machine: A,
      name: "Mac",
      at: 1,
      head: "",
      branch: null,
      snapshot: null,
    }),
    SID
  );
  const plan = await recv.beginBackup(m, SID, begin);
  assert.match(plan.backupId, /^[0-9a-f]{16}$/);
});

test("taking: no upload while a take-over has the row", async () => {
  const m = machine(A);
  await copyOnce(m, Buffer.from('{"a":1}\n'));
  db.getDb()
    .prepare(
      `UPDATE machine_backups SET state = 'taking', take_id = 'aaaaaaaaaaaaaaaa'`
    )
    .run();
  await code409(() => copyOnce(m, Buffer.from("x\n")), "taking");
});

test("missing_code: a commit naming code that never came", async () => {
  const m = machine(A);
  await code409(
    () => copyOnce(m, Buffer.from('{"a":1}\n'), { noBundle: true }),
    "missing_code"
  );
  assert.equal(store.backupRow(A, SID), null);
});

test("a session id starting with - or 81 characters long is refused", async () => {
  const m = machine(A);
  const { first } = await code();
  const begin = {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: 1,
  };
  await code409(() => recv.beginBackup(m, "-rf", begin), "bad_request");
  await code409(
    () => recv.beginBackup(m, "a".repeat(81), begin),
    "bad_request"
  );
  await code409(
    () => recv.syncSessions(m, { ids: ["--upload-pack=x"] }),
    "bad_request"
  );
});

test("a bundle with a bad object is refused", async () => {
  const m = machine(A);
  const { first } = await code();
  const plan = await recv.beginBackup(m, SID, {
    v: 1,
    claudeSessionId: CLAUDE,
    repo: { name: "work", remote: null, first },
    transcriptBytes: 1,
  });
  // A commit whose author line is malformed
  const tree = sh(["write-tree"]);
  const bad = execFileSync(
    "git",
    ["hash-object", "-t", "commit", "-w", "--literally", "--stdin"],
    {
      cwd: REPO,
      input: `tree ${tree}\nauthor broken\ncommitter broken\n\nbad\n`,
      encoding: "utf8",
    }
  ).trim();
  sh(["update-ref", `refs/agent-os/${SID}/backup-head`, bad]);
  const file = path.join(tmp, "bad.bundle");
  sh(["bundle", "create", "-q", file, `refs/agent-os/${SID}/backup-head`]);
  await code409(
    () => recv.receiveBundle(m, SID, plan.backupId, webFile(file)),
    "bad_request"
  );
});

test("a commit for (B, S) removes the copy (A, S)", async () => {
  await copyOnce(machine(A), Buffer.from('{"a":1}\n'));
  assert.ok(store.backupRow(A, SID));
  await copyOnce(machine(B), Buffer.from('{"a":1}\n'));
  assert.equal(store.backupRow(A, SID), null);
  assert.ok(store.backupRow(B, SID));
});

test("sessions sync drops only current copies it no longer lists", async () => {
  const m = machine(A);
  await copyOnce(m, Buffer.from('{"a":1}\n'));
  await copyOnce(m, Buffer.from('{"a":1}\n'), { sid: "s2" });
  db.getDb()
    .prepare(
      `UPDATE machine_backups SET state = 'taken', take_id = 'aaaaaaaaaaaaaaaa' WHERE session_id = 's2'`
    )
    .run();
  const { removed } = await recv.syncSessions(m, { ids: [] });
  assert.equal(removed, 1);
  assert.equal(store.backupRow(A, SID), null);
  assert.ok(store.backupRow(A, "s2"));
});

test("has_settings: a hook file in the copied tree is noticed", async () => {
  fs.mkdirSync(path.join(REPO, "sub", ".claude"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "sub", ".claude", "settings.json"), "{}");
  await copyOnce(machine(A), Buffer.from('{"a":1}\n'));
  assert.equal(store.backupRow(A, SID)!.has_settings, 1);
  assert.equal(recv.settingsNames([".claude/settings.local.json"]), true);
  assert.equal(recv.settingsNames(["src/settings.json"]), false);
});
