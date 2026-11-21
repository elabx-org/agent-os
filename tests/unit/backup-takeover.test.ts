import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { MachineRow } from "../../lib/link/store";
import type { MoveInState, MoveManifest } from "../../lib/session-move-types";
import type { TakeDeps } from "../../lib/backup/takeover";
import type { TakeJob } from "../../lib/backup/types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-take-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let db: typeof import("../../lib/db");
let store: typeof import("../../lib/backup/store");
let takeover: typeof import("../../lib/backup/takeover");
let takes: typeof import("../../lib/backup/takes");
let types: typeof import("../../lib/backup/types");

const A = "m_00000000000a";
const SID = "sess-1";
const CLAUDE = "0b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
const HEAD = "1".repeat(40);

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/backup/store");
  takeover = await import("../../lib/backup/takeover");
  takes = await import("../../lib/backup/takes");
  types = await import("../../lib/backup/types");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const machine = (caps = ["up1", "take1"]): MachineRow => ({
  id: A,
  name: "Mac",
  public_key: "k",
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
  caps: JSON.stringify(caps),
});

beforeEach(() => {
  db.getDb().exec("DELETE FROM machine_backups");
  db.getDb().exec("DELETE FROM sessions");
  takes.takes().clear();
  const manifest = {
    v: 1,
    sessionId: SID,
    name: "Fix login",
    claudeSessionId: CLAUDE,
    model: "sonnet",
    modelPinned: false,
    effort: null,
    permissionMode: "bypassPermissions",
    autoApprove: true,
    subagentModel: null,
    subagentOwnFirst: false,
    systemPrompt: null,
    repo: {
      name: "work",
      remote: null,
      head: HEAD,
      branch: "main",
      subdir: "",
    },
    snapshot: null,
    projectName: null,
    lastActiveAt: 1,
    transcriptBytes: 10,
  };
  db.getDb()
    .prepare(
      `INSERT INTO machine_backups (machine_id, session_id, machine_name, name,
         claude_session_id, manifest, repo_key, head, file_bytes, copied_at)
       VALUES (?, ?, 'Mac', 'Fix login', ?, ?, 'aaaaaaaaaaaaaaaa', ?, 10, 1000)`
    )
    .run(A, SID, CLAUDE, JSON.stringify(manifest), HEAD);
});

/** A move-in that does what it is told, and records what it was handed */
function fakeDeps(over: Partial<TakeDeps> = {}) {
  const seen: { manifest?: MoveManifest; told: string[]; cancelled: string[] } =
    { told: [], cancelled: [] };
  const phases = new Map<string, MoveInState["phase"] | "gone">();
  let hold = false;
  const deps: TakeDeps = {
    db: db.getDb(),
    machine: () => machine(),
    online: () => false,
    offlineFor: () => 10 * 60_000,
    tellTaken: (id) => seen.told.push(id),
    hubName: () => "Unraid",
    prepareMoveIn: (async (manifest: MoveManifest) => {
      seen.manifest = manifest;
      phases.set(manifest.moveId, "ready");
      return {} as never;
    }) as unknown as TakeDeps["prepareMoveIn"],
    moveInState: ((id: string) => {
      const phase = phases.get(id);
      if (!phase || phase === "gone") throw new Error("no such move");
      return {
        moveId: id,
        phase,
        have: [],
        result:
          phase === "done"
            ? {
                sessionId: SID,
                folder: "/repos/work",
                branch: "main",
                leftBehind: [],
              }
            : undefined,
      };
    }) as unknown as TakeDeps["moveInState"],
    receiveMoveFile:
      (async () => ({})) as unknown as TakeDeps["receiveMoveFile"],
    importMove: ((id: string) => {
      phases.set(id, hold ? "importing" : "done");
    }) as unknown as TakeDeps["importMove"],
    cancelMoveIn: (async (id: string) => {
      seen.cancelled.push(id);
      phases.set(id, "gone");
      return { stopped: true, phase: "preparing" };
    }) as unknown as TakeDeps["cancelMoveIn"],
    codeBytes: async () => 1000,
    freeBytes: async () => 100 * 1024 ** 3,
    pin: async () => ["refs/agent-os/x/out"],
    unpin: async () => {},
    bundle: async () => null,
    conversation: async () => Readable.from([]),
    dropConversation: async () => {},
    sleep: () => new Promise((r) => setTimeout(r, 5)),
    ...over,
  };
  return {
    deps,
    seen,
    holdImport: () => (hold = true),
    finish: () => {
      for (const [id, phase] of phases)
        if (phase === "importing") phases.set(id, "done");
    },
  };
}

async function settle(job: TakeJob): Promise<TakeJob> {
  for (let i = 0; i < 400; i++) {
    const now = takeover.takeJob(job.id)!;
    if (now.step === "done" || now.step === "failed") return now;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("never ended");
}

const W = () => types.TAKE_WHY_NOT;

async function untilStarting(job: TakeJob) {
  for (
    let i = 0;
    i < 400 && takeover.takeJob(job.id)!.step !== "starting";
    i++
  ) {
    await new Promise((r) => setTimeout(r, 5));
  }
  // importMove has been called once it shows "starting"
  await new Promise((r) => setTimeout(r, 20));
}

test("refusals: online, just dropped off, too old, not git, already here, settings, too large", async () => {
  const refused = async (
    over: Partial<TakeDeps>,
    why: string,
    settingsOk = true
  ) => {
    const { deps } = fakeDeps(over);
    await assert.rejects(
      () => takeover.startTake(A, SID, { settingsOk }, deps),
      (error: unknown) => {
        assert.ok(error instanceof takeover.TakeRefused);
        assert.equal(error.message, why);
        return true;
      }
    );
  };
  await refused({ online: () => true }, W().online("Mac"));
  await refused({ offlineFor: () => 30_000 }, W().justLeft("Mac"));
  await refused({ machine: () => machine(["up1"]) }, W().tooOld("Mac"));
  await refused({ codeBytes: async () => 30 * 1024 ** 3 }, W().tooLarge);
  await refused({ freeBytes: async () => 10 }, W().tooLarge);
  db.getDb().exec(`UPDATE machine_backups SET has_settings = 1`);
  await refused({}, W().settings, false);
  db.getDb().exec(
    `UPDATE machine_backups SET has_settings = 0, repo_key = NULL`
  );
  await refused({}, W().notGit);
  db.getDb().exec(`UPDATE machine_backups SET repo_key = 'aaaaaaaaaaaaaaaa'`);
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, working_directory) VALUES (?, 'S', '/tmp')`
    )
    .run(SID);
  await refused({}, W().alreadyHere);
  // Its own row is untouched by every refusal
  assert.equal(store.backupRow(A, SID)!.state, "current");
});

test("two starts at once: one wins", async () => {
  const one = fakeDeps();
  one.holdImport();
  const results = await Promise.allSettled([
    takeover.startTake(A, SID, { settingsOk: false }, one.deps),
    takeover.startTake(A, SID, { settingsOk: false }, one.deps),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find(
    (r) => r.status === "rejected"
  ) as PromiseRejectedResult;
  assert.equal(lost.reason.message, W().taking);
  const job = (
    results.find(
      (r) => r.status === "fulfilled"
    ) as PromiseFulfilledResult<TakeJob>
  ).value;
  await untilStarting(job);
  one.finish();
  assert.equal((await settle(job)).step, "done");
});

test("success: taken, the machine told, and the move-in asks first from an untrusted copy", async () => {
  const { deps, seen } = fakeDeps({ online: () => false });
  const job = await takeover.startTake(A, SID, { settingsOk: false }, deps);
  assert.equal(store.backupRow(A, SID)!.state, "taking");
  const end = await settle(job);
  assert.equal(end.step, "done");
  const row = store.backupRow(A, SID)!;
  assert.equal(row.state, "taken");
  assert.ok(row.taken_at);
  assert.equal(seen.manifest!.sourceTrusted, false);
  assert.equal(seen.manifest!.permissionMode, "manual");
  assert.equal(seen.manifest!.autoApprove, false);
  assert.equal(seen.manifest!.repo.head, HEAD);
  // Offline: told when it connects (takenFor), not now
  assert.deepEqual(seen.told, []);
});

test("success while it is back online: it is told at once", async () => {
  let online = false;
  const { deps, seen } = fakeDeps({ online: () => online });
  const job = await takeover.startTake(A, SID, { settingsOk: false }, deps);
  online = true;
  assert.equal((await settle(job)).step, "done");
  assert.deepEqual(seen.told, [A]);
});

test("a failure puts the copy back to current", async () => {
  const { deps, seen } = fakeDeps({
    receiveMoveFile: (async () => {
      throw new Error("disk full");
    }) as unknown as TakeDeps["receiveMoveFile"],
  });
  const job = await takeover.startTake(A, SID, { settingsOk: false }, deps);
  const end = await settle(job);
  assert.equal(end.step, "failed");
  assert.equal(end.error, "disk full");
  const row = store.backupRow(A, SID)!;
  assert.equal(row.state, "current");
  assert.equal(row.take_id, null);
  assert.equal(seen.cancelled.length, 1);
});

test("the machine back before the session is written here: called off", async () => {
  const { deps, seen } = fakeDeps({
    prepareMoveIn: (async () => {
      // Comes back while the copy is being got ready
      takes.onMachineBack({ id: A });
      return {} as never;
    }) as unknown as TakeDeps["prepareMoveIn"],
  });
  const job = await takeover.startTake(A, SID, { settingsOk: false }, deps);
  const end = await settle(job);
  assert.equal(end.step, "failed");
  assert.equal(end.error, W().cameBack("Mac"));
  assert.equal(store.backupRow(A, SID)!.state, "current");
  assert.ok(seen.cancelled.length >= 1);
});

test("the machine back after the commit point: it stands", async () => {
  const one = fakeDeps({
    cancelMoveIn: (async () => ({
      stopped: false,
      phase: "importing",
    })) as unknown as TakeDeps["cancelMoveIn"],
  });
  one.holdImport();
  const job = await takeover.startTake(A, SID, { settingsOk: false }, one.deps);
  for (
    let i = 0;
    i < 200 && takeover.takeJob(job.id)!.step !== "starting";
    i++
  ) {
    await new Promise((r) => setTimeout(r, 5));
  }
  takes.onMachineBack({ id: A });
  one.finish();
  assert.equal((await settle(job)).step, "done");
  assert.equal(store.backupRow(A, SID)!.state, "taken");
});

test("the machine connects while the checks run: it gives way, the copy stays current", async () => {
  // Offline at the check, online by the claim (codeBytes is async)
  let online = false;
  const { deps, seen } = fakeDeps({
    online: () => online,
    codeBytes: async () => {
      online = true;
      return 1000;
    },
  });
  await assert.rejects(
    () => takeover.startTake(A, SID, { settingsOk: false }, deps),
    (error: unknown) => {
      assert.ok(error instanceof takeover.TakeRefused);
      assert.equal(error.message, W().online("Mac"));
      return true;
    }
  );
  const row = store.backupRow(A, SID)!;
  assert.equal(row.state, "current");
  assert.equal(row.take_id, null);
  assert.equal(seen.manifest, undefined);
  assert.equal(takes.takes().size, 0);
});
