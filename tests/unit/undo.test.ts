import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { IdleDeps } from "../../lib/turns-busy";
import {
  claudeTurn,
  g,
  makeRepo,
  read,
  userState,
  write,
} from "./turns-fixture";

// lib/db and lib/claude-state read the env when they load
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-undo-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
delete process.env.AGENTOS_DISABLE_TICKERS;

let db: typeof import("../../lib/db");
let turns: typeof import("../../lib/turns");
let busy: typeof import("../../lib/turns-busy");

const repos: string[] = [];
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true });
});

before(async () => {
  db = await import("../../lib/db");
  const flags = await import("../../lib/flags");
  turns = await import("../../lib/turns");
  busy = await import("../../lib/turns-busy");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
  flags.setFlags({ snapshots: true });
});

let count = 0;
function setup(agent = "claude") {
  const root = makeRepo();
  repos.push(root);
  const id = `${agent}-u${++count}`;
  db.getDb()
    .prepare(
      "INSERT INTO sessions (id, name, tmux_name, agent_type, working_directory) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, id, id, agent, root);
  const session = db.queries.getSession(db.getDb()).get(id) as Session;
  const dir = path.join(process.env.AGENT_OS_HOME!, "claude-state", id);
  const notices: { sessionId: string; text: string }[] = [];
  const notify = (sessionId: string, text: string) =>
    notices.push({ sessionId, text });
  return { root, session, dir, notices, notify };
}

describe("undoTurn", () => {
  test("restores the agent's files; the user's index and refs stay", async () => {
    const { root, session, dir, notices, notify } = setup();
    fs.rmSync(path.join(root, "untracked.txt"));
    const before = userState(root);
    const runSh = fs.statSync(path.join(root, "run.sh")).mode;

    await claudeTurn(dir, root, "Change things", (touch) => {
      write(root, "a.txt", "alpha by the agent\n");
      touch("a.txt");
      write(root, "lib/new.ts", "export {};\n");
      touch("lib/new.ts", "Write");
      write(root, "run.sh", "#!/bin/sh\necho changed\n");
      touch("run.sh");
      fs.rmSync(path.join(root, "src/d.ts"));
      touch("src/d.ts");
    });
    assert.notEqual(userState(root).status, before.status);
    const midIndex = userState(root).index;

    const detail = await turns.turnDetail(session, 1);
    const paths = detail!.files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["a.txt", "lib/new.ts", "run.sh", "src/d.ts"]);
    const result = await turns.undoTurn(session, 1, paths, { notify });
    assert.deepEqual(result.reverted.sort(), paths);
    assert.deepEqual(result.kept, []);

    assert.equal(read(root, "a.txt"), "alpha\n");
    assert.equal(read(root, "src/d.ts"), "export const d = 1;\n");
    assert.ok(!fs.existsSync(path.join(root, "lib/new.ts")));
    assert.equal(fs.statSync(path.join(root, "run.sh")).mode, runSh);
    // Staged c.txt and everything else exactly as before the turn
    assert.equal(userState(root).index, midIndex);
    assert.deepEqual(userState(root), before);

    assert.equal(notices.length, 1);
    assert.equal(notices[0].sessionId, session.id);
    assert.match(notices[0].text, /^\[Agent-OS: the user undid turn 1; /);
    assert.match(notices[0].text, /a\.txt/);

    const [turn] = await turns.listTurns(session);
    assert.ok(turn.undoneAt);
    const again = await turns.turnDetail(session, 1);
    assert.equal(again?.reason, "undone");
    await assert.rejects(
      turns.undoTurn(session, 1, paths, { notify }),
      (e: unknown) => e instanceof turns.TurnError && e.reason === "undone"
    );
  });

  test("a file the user changed after the turn is kept", async () => {
    const { root, session, dir, notify, notices } = setup();
    await claudeTurn(dir, root, "Edit a and b", (touch) => {
      write(root, "a.txt", "agent a\n");
      touch("a.txt");
      write(root, "b.txt", "agent b\n");
      touch("b.txt");
    });
    write(root, "a.txt", "agent a\nthen the user\n");
    const result = await turns.undoTurn(session, 1, ["a.txt", "b.txt"], {
      notify,
    });
    assert.deepEqual(result.reverted, ["b.txt"]);
    assert.deepEqual(result.kept, [{ path: "a.txt", reason: "changed_since" }]);
    assert.equal(read(root, "a.txt"), "agent a\nthen the user\n");
    assert.equal(read(root, "b.txt"), "bravo\n");
    assert.match(notices[0].text, /b\.txt is back to how it was/);
  });

  test("another session's edit during the turn is left alone", async () => {
    const { root, session, dir, notify } = setup();
    await claudeTurn(dir, root, "Mine", (touch) => {
      write(root, "a.txt", "agent a\n");
      touch("a.txt");
      // A second session working in the same checkout
      write(root, "b.txt", "other session\n");
    });
    const detail = await turns.turnDetail(session, 1);
    assert.deepEqual(
      detail?.files.map((f) => f.path),
      ["a.txt"]
    );
    assert.deepEqual(
      detail?.alsoChanged.map((f) => f.path),
      ["b.txt"]
    );
    // The sheet sends only the checked files
    const result = await turns.undoTurn(
      session,
      1,
      detail!.files.map((f) => f.path),
      { notify }
    );
    assert.deepEqual(result.reverted, ["a.txt"]);
    assert.equal(read(root, "b.txt"), "other session\n");
  });

  test("paths not changed in the turn are ignored; nothing reverted, no notice", async () => {
    const { root, session, dir, notify, notices } = setup();
    await claudeTurn(dir, root, "a", (touch) => {
      write(root, "a.txt", "agent\n");
      touch("a.txt");
    });
    const result = await turns.undoTurn(
      session,
      1,
      ["../outside", "/etc/passwd", "c.txt"],
      { notify }
    );
    assert.deepEqual(result, { reverted: [], kept: [] });
    assert.equal(notices.length, 0);
    assert.equal(read(root, "a.txt"), "agent\n");
  });

  test("an older turn: files a later turn changed again are kept", async () => {
    const { root, session, dir, notify } = setup();
    await claudeTurn(dir, root, "one", (touch) => {
      write(root, "a.txt", "turn 1\n");
      touch("a.txt");
      write(root, "b.txt", "turn 1\n");
      touch("b.txt");
    });
    await claudeTurn(dir, root, "two", (touch) => {
      write(root, "a.txt", "turn 2\n");
      touch("a.txt");
    });
    const result = await turns.undoTurn(session, 1, ["a.txt", "b.txt"], {
      notify,
    });
    assert.deepEqual(result.reverted, ["b.txt"]);
    assert.deepEqual(result.kept, [{ path: "a.txt", reason: "changed_since" }]);
    assert.equal(read(root, "a.txt"), "turn 2\n");
  });

  test("works in a linked worktree", async () => {
    const { root, session, dir, notify } = setup();
    const wt = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "agentos-wt-")),
      "w"
    );
    repos.push(path.dirname(wt));
    g(root, "worktree", "add", "-q", wt, "side");
    const before = userState(wt);
    await claudeTurn(dir, wt, "in the worktree", (touch) => {
      write(wt, "a.txt", "worktree agent\n");
      touch("a.txt");
    });
    const detail = await turns.turnDetail(session, 1);
    assert.deepEqual(
      detail?.files.map((f) => f.path),
      ["a.txt"]
    );
    const result = await turns.undoTurn(session, 1, ["a.txt"], { notify });
    assert.deepEqual(result.reverted, ["a.txt"]);
    assert.deepEqual(userState(wt), before);
  });

  test("a Codex turn undoes the same way", async () => {
    const { root, session, notify } = setup("codex");
    await turns.beforeAgentSend(session, "go");
    write(root, "a.txt", "codex\n");
    await turns.onIdleEdge(session);
    const result = await turns.undoTurn(session, 1, ["a.txt"], { notify });
    assert.deepEqual(result.reverted, ["a.txt"]);
    assert.equal(read(root, "a.txt"), "alpha\n");
  });
});

describe("agentIdle", () => {
  const session = { id: "x", agent_type: "claude" } as Session;
  const deps = (over: Partial<IdleDeps>): IdleDeps => ({
    running: async () => true,
    readiness: async () => ({ ready: false, holdReason: "unknown" }),
    status: async () => "running",
    claudeBusy: () => null,
    ...over,
  });

  test("not running, or ready: idle", async () => {
    assert.equal(
      await busy.agentIdle(session, deps({ running: async () => false })),
      true
    );
    assert.equal(
      await busy.agentIdle(
        session,
        deps({ readiness: async () => ({ ready: true, holdReason: null }) })
      ),
      true
    );
  });

  test("Claude: the hooks decide when they know", async () => {
    assert.equal(
      await busy.agentIdle(session, deps({ claudeBusy: () => true })),
      false
    );
    assert.equal(
      await busy.agentIdle(session, deps({ claudeBusy: () => false })),
      true
    );
  });

  test("otherwise the watched status", async () => {
    const codex = { id: "y", agent_type: "codex" } as Session;
    assert.equal(
      await busy.agentIdle(codex, deps({ status: async () => "idle" })),
      true
    );
    assert.equal(
      await busy.agentIdle(codex, deps({ status: async () => "waiting" })),
      false
    );
    assert.equal(
      await busy.agentIdle(codex, deps({ status: async () => "running" })),
      false
    );
  });
});
