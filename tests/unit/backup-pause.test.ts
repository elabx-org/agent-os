import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { TakenSession } from "../../lib/link/protocol";
import type { PauseDeps } from "../../lib/backup/machine";
import type { MovedTo } from "../../lib/session-move-types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-pause-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

let machine: typeof import("../../lib/backup/machine");
let hold: typeof import("../../lib/backup/hold");

const SID = "sess-1";
const CLAUDE = "0b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
const HEAD = "1".repeat(40);
const TAKE = "a".repeat(16);
const CONVO = path.join(tmp, "convo.jsonl");

before(async () => {
  machine = await import("../../lib/backup/machine");
  hold = await import("../../lib/backup/hold");
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  hold.heldSessions().clear();
  fs.writeFileSync(CONVO, "x".repeat(10));
  fs.rmSync(path.join(tmp, "home"), { recursive: true, force: true });
});

const session = (over: Partial<Session> = {}): Session =>
  ({
    id: SID,
    name: "Fix login",
    working_directory: "/repos/work",
    worktree_path: null,
    claude_session_id: CLAUDE,
    settled_at: null,
    settled_reason: null,
    moved_to: null,
    paused_at: null,
    ...over,
  }) as unknown as Session;

const taken = (over: Partial<TakenSession> = {}): TakenSession => ({
  sessionId: SID,
  takeId: TAKE,
  at: 2000,
  copyAt: 1000,
  hubName: "Unraid",
  claudeSessionId: CLAUDE,
  transcriptBytes: 10,
  head: HEAD,
  tree: null,
  ...over,
});

function fakes(over: Partial<PauseDeps> = {}, row: Session = session()) {
  const seen = {
    kills: 0,
    settled: 0,
    written: null as MovedTo | null,
    kept: [] as string[],
  };
  let running = true;
  const deps: PauseDeps = {
    getSession: () => row,
    isRunning: async () => running,
    kill: async () => {
      seen.kills++;
      running = false;
    },
    settle: async () => {
      seen.settled++;
    },
    snapshot: async () => null,
    head: async () => ({ head: HEAD, branch: "main" }),
    conversation: async () => ({ sessionId: CLAUDE, file: CONVO }),
    keep: async (_file, dir) => {
      seen.kept.push(dir);
    },
    write: (_id, movedTo) => {
      seen.written = movedTo;
    },
    now: () => 3000,
    ...over,
  };
  return { deps, seen };
}

test("its tmux is killed even when the row already says settled", async () => {
  const { deps, seen } = fakes(
    {},
    session({ settled_at: 5, settled_reason: "merged" } as Partial<Session>)
  );
  const [result] = await machine.pauseTaken([taken()], deps);
  assert.equal(result.state, "paused");
  assert.equal(seen.kills, 1);
  assert.equal(seen.settled, 1);
  assert.ok(hold.isHeld(SID));
});

test("failed when its tmux can't be seen gone", async () => {
  const { deps, seen } = fakes({ kill: async () => {} });
  const [result] = await machine.pauseTaken([taken()], deps);
  assert.equal(result.state, "failed");
  assert.equal(seen.written, null);
  // Held all the same: nothing starts it from here
  assert.ok(hold.isHeld(SID));
});

test("a handed-off row is paused the same way", async () => {
  const { deps, seen } = fakes(
    {},
    session({ paused_at: 9 } as Partial<Session>)
  );
  const [result] = await machine.pauseTaken([taken()], deps);
  assert.equal(result.state, "paused");
  assert.equal(seen.settled, 1);
});

test("ahead: the conversation the live pane was on counts, not the row's", async () => {
  fs.writeFileSync(CONVO, "x".repeat(10));
  let alive = true;
  const { deps } = fakes({
    isRunning: async () => alive,
    kill: async () => {
      alive = false;
    },
    // Only the pane knows the new id; once it's gone the row's old one is left
    conversation: async () => ({
      sessionId: alive ? "1b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b" : CLAUDE,
      file: CONVO,
    }),
  });
  const [r] = await machine.pauseTaken([taken()], deps);
  assert.equal(r.ahead!.conversation, true);
});

test("ahead: nothing more, more conversation, a different Claude id, more code", async () => {
  let r = await machine.pauseTaken([taken()], fakes().deps);
  assert.deepEqual(r[0].ahead, { conversation: false, code: false });

  fs.writeFileSync(CONVO, "x".repeat(20));
  const more = fakes();
  r = await machine.pauseTaken([taken()], more.deps);
  assert.deepEqual(r[0].ahead, { conversation: true, code: false });
  assert.deepEqual(more.seen.kept, [
    path.join(process.env.AGENT_OS_HOME!, "kept", `${SID}-${TAKE}`),
  ]);

  fs.writeFileSync(CONVO, "x".repeat(10));
  r = await machine.pauseTaken(
    [taken()],
    fakes({
      conversation: async () => ({
        sessionId: "1b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b",
        file: CONVO,
      }),
    }).deps
  );
  assert.equal(r[0].ahead!.conversation, true);

  r = await machine.pauseTaken(
    [taken()],
    fakes({
      snapshot: async () =>
        ({ commit: "2".repeat(40), tree: "3".repeat(40) }) as never,
    }).deps
  );
  assert.deepEqual(r[0].ahead, { conversation: false, code: true });
});

test("moved_to.takeover: the hub, its name, the copy's time and what is ahead", async () => {
  const { deps, seen } = fakes({
    head: async () => ({ head: "4".repeat(40), branch: "main" }),
  });
  const [result] = await machine.pauseTaken([taken()], deps);
  assert.equal(result.folder, "/repos/work");
  assert.deepEqual(seen.written, {
    machine: "hub",
    name: "Unraid",
    at: 3000,
    head: "4".repeat(40),
    branch: "main",
    snapshot: null,
    takeover: {
      takeId: TAKE,
      copyAt: 1000,
      ahead: { conversation: false, code: true },
    },
  });
});

test("already paused for this take: said again, nothing written twice", async () => {
  const went: MovedTo = {
    machine: "hub",
    name: "Unraid",
    at: 1,
    head: HEAD,
    branch: "main",
    snapshot: null,
    takeover: {
      takeId: TAKE,
      copyAt: 1000,
      ahead: { conversation: true, code: false },
    },
  };
  const { deps, seen } = fakes(
    {},
    session({
      moved_to: JSON.stringify(went),
      settled_at: 1,
      settled_reason: "moved",
    } as Partial<Session>)
  );
  const [result] = await machine.pauseTaken([taken()], deps);
  assert.equal(result.state, "already");
  assert.deepEqual(result.ahead, { conversation: true, code: false });
  assert.equal(seen.written, null);
  assert.equal(seen.settled, 0);
});

test("gone: not here, or it went on to another machine", async () => {
  let r = await machine.pauseTaken(
    [taken()],
    fakes({ getSession: () => null }).deps
  );
  assert.equal(r[0].state, "gone");
  r = await machine.pauseTaken(
    [taken()],
    fakes(
      {},
      session({
        moved_to: JSON.stringify({
          machine: "m_00000000000b",
          name: "Other",
          at: 1,
          head: HEAD,
          branch: null,
          snapshot: null,
        }),
      } as Partial<Session>)
    ).deps
  );
  assert.equal(r[0].state, "gone");
});

test("a bad id in the list is ignored, not held", async () => {
  const r = await machine.pauseTaken(
    [taken({ sessionId: "-rf" }), taken({ takeId: "nope" })],
    fakes().deps
  );
  assert.deepEqual(r, []);
  assert.equal(hold.isHeld("-rf"), false);
});

test("on the server: paused for the machine that carried it on", async () => {
  const { deps, seen } = fakes();
  const peer = { id: "m_0123456789ab" };
  const [result] = await machine.pauseTaken(
    [taken({ hubName: "Mac Studio" })],
    deps,
    peer
  );
  assert.equal(result.state, "paused");
  assert.equal(seen.written?.machine, "m_0123456789ab");
  assert.equal(seen.written?.name, "Mac Studio");
  assert.equal(seen.written?.takeover?.takeId, TAKE);
  // Settled as moved is what keeps it from starting: no hold is left
  assert.equal(hold.heldSessions().has(SID), false);
});

test("on the server: one that went to another machine is left alone", async () => {
  const went = JSON.stringify({ machine: "m_ffffffffffff", name: "Other" });
  const { deps, seen } = fakes({}, session({ moved_to: went }));
  const [result] = await machine.pauseTaken([taken()], deps, {
    id: "m_0123456789ab",
  });
  assert.equal(result.state, "gone");
  assert.equal(seen.kills, 0);
  assert.equal(seen.written, null);
});
