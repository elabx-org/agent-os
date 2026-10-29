import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import { agentRefs, claudeTurn, g, makeRepo, write } from "./turns-fixture";

// lib/db and lib/claude-state read the env when they load
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-turns-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
delete process.env.AGENTOS_DISABLE_TICKERS;

let db: typeof import("../../lib/db");
let flags: typeof import("../../lib/flags");
let turns: typeof import("../../lib/turns");

const repos: string[] = [];
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true });
});

before(async () => {
  db = await import("../../lib/db");
  flags = await import("../../lib/flags");
  turns = await import("../../lib/turns");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
  flags.setFlags({ snapshots: true });
});

function repo(): string {
  const root = makeRepo();
  repos.push(root);
  return root;
}

function addSession(id: string, agent: string, cwd: string): Session {
  db.getDb()
    .prepare(
      "INSERT INTO sessions (id, name, tmux_name, agent_type, working_directory) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, id, `${agent}-${id}`, agent, cwd);
  return db.queries.getSession(db.getDb()).get(id) as Session;
}

const stateDir = (id: string) =>
  path.join(process.env.AGENT_OS_HOME!, "claude-state", id);

describe("foldJournal", () => {
  test("folds events by turn, last post wins, touched deduplicated", () => {
    const text = [
      {
        e: "pre",
        turnNo: 1,
        cwd: "/r",
        promptExcerpt: "hi",
        preRef: "p1",
        startedAt: 10,
      },
      { e: "touch", turnNo: 1, path: "/r/a" },
      { e: "touch", turnNo: 1, path: "/r/a" },
      { e: "touch", turnNo: 1, path: "/r/b" },
      {
        e: "post",
        turnNo: 1,
        postRef: "q1",
        transcriptUuid: "u1",
        endedAt: 20,
      },
      {
        e: "post",
        turnNo: 1,
        postRef: "q1b",
        transcriptUuid: null,
        endedAt: 30,
      },
      { e: "pre", turnNo: 2, cwd: "/r", preRef: null, startedAt: 40 },
    ]
      .map((e) => JSON.stringify(e))
      .concat(["not json", '{"turnNo":"x"}', ""])
      .join("\n");
    const folded = turns.foldJournal(text);
    assert.equal(folded.length, 2);
    assert.deepEqual(folded[0], {
      turnNo: 1,
      cwd: "/r",
      promptExcerpt: "hi",
      transcriptUuid: "u1",
      preRef: "p1",
      postRef: "q1b",
      startedAt: 10,
      endedAt: 30,
      touched: ["/r/a", "/r/b"],
    });
    assert.equal(folded[1].preRef, null);
    assert.equal(folded[1].postRef, null);
  });
});

describe("parseChanges", () => {
  test("numstat + name-status, binary as 0/0", () => {
    const numstat = "3\t1\ta.txt\0-\t-\timg.png\0" + "0\t2\tgone.txt\0";
    const names = "M\0a.txt\0A\0img.png\0D\0gone.txt\0";
    assert.deepEqual(turns.parseChanges(numstat, names), [
      { path: "a.txt", status: "M", added: 3, removed: 1 },
      { path: "img.png", status: "A", added: 0, removed: 0 },
      { path: "gone.txt", status: "D", added: 0, removed: 2 },
    ]);
  });
});

describe("Claude turns from the hook journal", () => {
  test("listTurns and turnDetail: the agent's files vs also changed", async () => {
    const root = repo();
    const session = addSession("claude-1", "claude", root);
    await claudeTurn(stateDir(session.id), root, "Fix alpha", (touch) => {
      write(root, "a.txt", "alpha\nmore\n");
      touch("a.txt");
      write(root, "new.ts", "new\n");
      touch("new.ts", "Write");
      // The user (or a Bash command) changes b.txt meanwhile
      write(root, "b.txt", "bravo by the user\n");
    });

    const list = await turns.listTurns(session);
    assert.equal(list.length, 1);
    const [turn] = list;
    assert.equal(turn.turnNo, 1);
    assert.equal(turn.promptExcerpt, "Fix alpha");
    assert.deepEqual(turn.files.map((f) => [f.path, f.status]).sort(), [
      ["a.txt", "M"],
      ["b.txt", "M"],
      ["new.ts", "A"],
    ]);
    assert.equal(turn.added, 3);
    assert.equal(turn.removed, 1);
    assert.equal(turn.undoneAt, null);

    const detail = await turns.turnDetail(session, 1);
    assert.ok(detail);
    assert.deepEqual(detail.files.map((f) => f.path).sort(), [
      "a.txt",
      "new.ts",
    ]);
    assert.deepEqual(
      detail.alsoChanged.map((f) => f.path),
      ["b.txt"]
    );
    assert.deepEqual(detail.touched.sort(), ["a.txt", "new.ts"]);
    assert.equal(detail.undoable, true);
    assert.equal(await turns.turnDetail(session, 2), null);
  });

  test("snapshots off for the session: no turns", async () => {
    const root = repo();
    const session = addSession("claude-off", "claude", root);
    flags.setFlags({ snapshots: false });
    try {
      assert.deepEqual(await turns.listTurns(session), []);
      assert.equal(await turns.turnDetail(session, 1), null);
      flags.setFlagSessions({ snapshots: [session.id] });
      await claudeTurn(stateDir(session.id), root, "On for me", (touch) => {
        write(root, "a.txt", "x\n");
        touch("a.txt");
      });
      assert.equal((await turns.listTurns(session)).length, 1);
    } finally {
      flags.setFlagSessions({ snapshots: [] });
      flags.setFlags({ snapshots: true });
    }
  });

  test("a turn whose pre snapshot overran can't be undone", async () => {
    const root = repo();
    const session = addSession("claude-nopre", "claude", root);
    fs.mkdirSync(stateDir(session.id), { recursive: true });
    g(root, "update-ref", `refs/agent-os/${session.id}/t1-post`, "HEAD");
    fs.writeFileSync(
      path.join(stateDir(session.id), "turns.jsonl"),
      [
        { e: "pre", turnNo: 1, cwd: root, preRef: null, startedAt: 1 },
        { e: "touch", turnNo: 1, path: path.join(root, "a.txt") },
        {
          e: "post",
          turnNo: 1,
          postRef: `refs/agent-os/${session.id}/t1-post`,
          endedAt: 2,
        },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n"
    );
    const detail = await turns.turnDetail(session, 1);
    assert.equal(detail?.undoable, false);
    assert.equal(detail?.reason, "no_snapshot");
    await assert.rejects(
      turns.undoTurn(session, 1, ["a.txt"], { notify: () => {} }),
      (e: unknown) => e instanceof turns.TurnError && e.reason === "no_snapshot"
    );
  });

  test("a turn still running: not undoable yet", async () => {
    const root = repo();
    const session = addSession("claude-running", "claude", root);
    fs.mkdirSync(stateDir(session.id), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir(session.id), "turns.jsonl"),
      JSON.stringify({
        e: "pre",
        turnNo: 1,
        cwd: root,
        preRef: "refs/x",
        startedAt: 1,
      }) + "\n"
    );
    const detail = await turns.turnDetail(session, 1);
    assert.equal(detail?.reason, "running");
    const [turn] = await turns.listTurns(session);
    assert.deepEqual(turn.files, []);
    assert.equal(turn.endedAt, null);
  });

  test("keeps the newest 50 turns, pruning older refs", async () => {
    const root = repo();
    const session = addSession("claude-many", "claude", root);
    fs.mkdirSync(stateDir(session.id), { recursive: true });
    const lines: string[] = [];
    for (let n = 1; n <= 55; n++) {
      for (const point of ["pre", "post"]) {
        g(
          root,
          "update-ref",
          `refs/agent-os/${session.id}/t${n}-${point}`,
          "HEAD"
        );
      }
      lines.push(
        JSON.stringify({
          e: "pre",
          turnNo: n,
          cwd: root,
          preRef: `refs/agent-os/${session.id}/t${n}-pre`,
          startedAt: n,
        }),
        JSON.stringify({
          e: "post",
          turnNo: n,
          postRef: `refs/agent-os/${session.id}/t${n}-post`,
          endedAt: n,
        })
      );
    }
    fs.writeFileSync(
      path.join(stateDir(session.id), "turns.jsonl"),
      lines.join("\n") + "\n"
    );
    // Rows for the oldest exist from an earlier ingest
    db.getDb()
      .prepare(
        "INSERT INTO session_turns (session_id, turn_no, cwd, pre_ref) VALUES (?, 1, ?, ?)"
      )
      .run(session.id, root, `refs/agent-os/${session.id}/t1-pre`);

    const list = await turns.listTurns(session);
    assert.equal(list.length, turns.MAX_TURNS);
    assert.equal(list[0].turnNo, 6);
    const refs = agentRefs(root, session.id);
    assert.ok(!refs.includes(`refs/agent-os/${session.id}/t1-pre`));
    assert.ok(refs.includes(`refs/agent-os/${session.id}/t6-pre`));
  });

  test("pruneSessionTurns: refs, rows, journal and private index go", async () => {
    const root = repo();
    const session = addSession("claude-prune", "claude", root);
    await claudeTurn(stateDir(session.id), root, "x", (touch) => {
      write(root, "a.txt", "x\n");
      touch("a.txt");
    });
    assert.equal((await turns.listTurns(session)).length, 1);
    const privateIndex = path.join(
      root,
      ".git",
      "agent-os",
      `index-${session.id}`
    );
    assert.ok(fs.existsSync(privateIndex));

    await turns.pruneSessionTurns(session);
    assert.deepEqual(agentRefs(root, session.id), []);
    assert.ok(!fs.existsSync(privateIndex));
    assert.ok(!fs.existsSync(path.join(stateDir(session.id), "turns.jsonl")));
    assert.deepEqual(await turns.listTurns(session), []);
  });

  test("pruneSettled: nothing before M8's settled_at exists", async () => {
    assert.equal(await turns.pruneSettled(0), 0);
  });
});

describe("Codex/Gemini turns from the dispatcher and the idle edge", () => {
  test("pre before the send, post on idle: every file the agent's", async () => {
    const root = repo();
    const session = addSession("codex-1", "codex", root);
    await turns.beforeAgentSend(session, "Rename  the\nthing");
    write(root, "a.txt", "codex was here\n");
    await turns.onIdleEdge(session);

    const [turn] = await turns.listTurns(session);
    assert.equal(turn.turnNo, 1);
    assert.equal(turn.promptExcerpt, "Rename the thing");
    assert.ok(turn.endedAt);
    const detail = await turns.turnDetail(session, 1);
    assert.deepEqual(
      detail?.files.map((f) => f.path),
      ["a.txt"]
    );
    assert.deepEqual(detail?.alsoChanged, []);

    // The next send is turn 2
    await turns.beforeAgentSend(session, "again");
    assert.equal((await turns.listTurns(session)).length, 2);
  });

  test("another session busy in the folder: every file unchecked", async () => {
    const root = repo();
    const session = addSession("codex-2", "codex", root);
    const other = addSession("gemini-2", "gemini", root);
    await turns.beforeAgentSend(other, "other work");
    await turns.beforeAgentSend(session, "my work");
    write(root, "a.txt", "mine?\n");
    write(root, "b.txt", "theirs?\n");
    await turns.onIdleEdge(session);

    const detail = await turns.turnDetail(session, 1);
    assert.deepEqual(detail?.files, []);
    assert.deepEqual(detail?.alsoChanged.map((f) => f.path).sort(), [
      "a.txt",
      "b.txt",
    ]);
  });

  test("a non-git folder: no turns, nothing written", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-plain-"));
    repos.push(plain);
    const session = addSession("codex-plain", "codex", plain);
    await turns.beforeAgentSend(session, "hi");
    await turns.onIdleEdge(session);
    assert.deepEqual(await turns.listTurns(session), []);
    assert.deepEqual(fs.readdirSync(plain), []);
  });

  test("Claude sessions don't take snapshots from the dispatcher", async () => {
    const root = repo();
    const session = addSession("claude-disp", "claude", root);
    await turns.beforeAgentSend(session, "hi");
    assert.deepEqual(agentRefs(root, session.id), []);
  });
});

describe("sessionDiff", () => {
  let diff: typeof import("../../lib/turns-diff");
  before(async () => {
    diff = await import("../../lib/turns-diff");
  });

  test("turn: pre..post, one file on request", async () => {
    const root = repo();
    const session = addSession("claude-diff", "claude", root);
    await claudeTurn(stateDir(session.id), root, "d", (touch) => {
      write(root, "a.txt", "alpha\nbeta\n");
      touch("a.txt");
      write(root, "b.txt", "b2\n");
    });
    const all = await diff.sessionDiff(session, "turn:1", null);
    assert.deepEqual(all?.files.map((f) => f.newFile).sort(), [
      "a.txt",
      "b.txt",
    ]);
    assert.equal(all?.base, `refs/agent-os/${session.id}/t1-pre`);
    assert.equal(all?.head, `refs/agent-os/${session.id}/t1-post`);
    const one = await diff.sessionDiff(session, "turn:1", "a.txt");
    assert.deepEqual(
      one?.files.map((f) => f.newFile),
      ["a.txt"]
    );
    assert.equal(one?.files[0].additions, 1);
    assert.equal(await diff.sessionDiff(session, "turn:9", null), null);
  });

  test("uncommitted: tracked changes vs HEAD plus untracked as added", async () => {
    const root = repo();
    const session = addSession("codex-diff", "codex", root);
    const before = g(root, "status", "--porcelain");
    const result = await diff.sessionDiff(session, "uncommitted", null);
    const names = result!.files.map((f) => f.newFile).sort();
    assert.deepEqual(names, ["c.txt", "untracked.txt"]);
    assert.equal(
      result!.files.find((f) => f.newFile === "untracked.txt")?.isNew,
      true
    );
    assert.equal(result!.base, g(root, "rev-parse", "HEAD").trim());
    assert.equal(g(root, "status", "--porcelain"), before);
  });

  test("branch: from the merge-base with the base branch", async () => {
    const root = repo();
    g(root, "checkout", "-q", "-b", "feature");
    write(root, "f.txt", "feature\n");
    g(root, "add", "f.txt");
    g(root, "commit", "-q", "-m", "feature");
    const session = addSession("codex-branch", "codex", root);
    const result = await diff.sessionDiff(session, "branch", null);
    const names = result!.files.map((f) => f.newFile).sort();
    assert.deepEqual(names, ["c.txt", "f.txt", "untracked.txt"]);
    assert.equal(result!.base, g(root, "rev-parse", "main").trim());
  });

  test("bad scopes and files outside the repo are refused", async () => {
    const root = repo();
    const session = addSession("codex-bad", "codex", root);
    for (const [scope, file] of [
      ["nope", null],
      ["turn:x", null],
      ["uncommitted", "../etc/passwd"],
      ["uncommitted", "/etc/passwd"],
      ["uncommitted", "a/../../x"],
    ] as const) {
      await assert.rejects(
        diff.sessionDiff(session, scope, file),
        diff.DiffRequestError
      );
    }
  });
});
