import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { Readiness } from "../../lib/session-ready";
import type { QueueItem } from "../../lib/queue/types";
import type {
  MoveSnapshot,
  MoveSnapshotPath,
  WorkingTreeState,
} from "../../lib/worktree-move-git";
import type { MoveState } from "../../lib/worktree-move-types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-move-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");

let db: typeof import("../../lib/db");
let store: typeof import("../../lib/queue/store");
let mod: typeof import("../../lib/worktree-move");
let launch: typeof import("../../lib/session-launch");
let types: typeof import("../../lib/worktree-move-types");
let moving: typeof import("../../lib/worktree-moving");

before(async () => {
  db = await import("../../lib/db");
  store = await import("../../lib/queue/store");
  mod = await import("../../lib/worktree-move");
  launch = await import("../../lib/session-launch");
  types = await import("../../lib/worktree-move-types");
  moving = await import("../../lib/worktree-moving");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SID = "0b5e3a3c-1d2e-4f50-9a6b-7c8d9e0f1a2b";
const REPO = path.join(tmp, "repo");
const WT_ROOT = path.join(tmp, "worktrees");
const projects = () => path.join(process.env.CLAUDE_CONFIG_DIR!, "projects");
const projectDir = (cwd: string) =>
  path.join(projects(), cwd.replace(/[^a-zA-Z0-9]/g, "-"));

beforeEach(() => {
  const d = db.getDb();
  d.exec("DELETE FROM sessions");
  d.exec("DELETE FROM session_queue");
  for (const dir of [REPO, WT_ROOT, process.env.CLAUDE_CONFIG_DIR!]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(REPO, { recursive: true });
  fs.mkdirSync(WT_ROOT, { recursive: true });
  // The conversation Claude wrote in the source folder
  fs.mkdirSync(path.join(projectDir(REPO), SID, "subagents"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(projectDir(REPO), `${SID}.jsonl`),
    '{"type":"user"}\n{"type":"assistant"}\n'
  );
  fs.writeFileSync(
    path.join(projectDir(REPO), SID, "subagents", "agent-1.jsonl"),
    '{"type":"user"}\n'
  );
});

function addSession(
  id: string,
  extra: Partial<Record<keyof Session, unknown>> = {}
): Session {
  const d = db.getDb();
  db.queries
    .createSession(d)
    .run(
      id,
      `KeyboardBar haptics ${id}`,
      `claude-${id}`,
      REPO,
      null,
      "opus",
      null,
      "sessions",
      "claude",
      0,
      0,
      "uncategorized"
    );
  d.prepare(
    `UPDATE sessions SET claude_session_id = ?, updated_at = '2026-01-01 00:00:00' WHERE id = ?`
  ).run(SID, id);
  for (const [key, value] of Object.entries(extra)) {
    d.prepare(`UPDATE sessions SET ${key} = ? WHERE id = ?`).run(value, id);
  }
  return row(id)!;
}

const row = (id: string) =>
  (db.queries.getSession(db.getDb()).get(id) as Session | undefined) ?? null;

type Step =
  | "snapshot"
  | "create"
  | "materialise"
  | "verify"
  | "clean"
  | "restore"
  | "copy"
  | "stop";

/**
 * An in-memory repo at REPO: HEAD's files, the working tree's, branches and
 * worktrees (real folders, so the folder checks see them). Steps in `fail`
 * throw
 */
function fakeRepo() {
  const head = new Map<string, string>([
    ["KeyboardBar.swift", "kb v1"],
    ["Haptics.swift", "h v1"],
    ["README.md", "readme"],
  ]);
  const files = new Map(head);
  files.set("KeyboardBar.swift", "kb v2");
  files.set("Haptics.swift", "h v2");
  files.set("New.swift", "new");
  files.delete("README.md");
  const branches = new Set(["main"]);
  const worktrees = new Map<string, Map<string, string>>();
  const snapshots = new Map<string, Map<string, string | null>>();
  const fail = new Set<Step>();
  const log: string[] = [];
  let staged = false;
  const check = (step: Step) => {
    if (fail.has(step)) throw new Error(`injected: ${step}`);
  };

  const changes = (): MoveSnapshotPath[] => {
    const out: MoveSnapshotPath[] = [];
    for (const [p, c] of files) {
      if (!head.has(p)) out.push({ path: p, change: "added", mode: "100644" });
      else if (head.get(p) !== c)
        out.push({ path: p, change: "modified", mode: "100644" });
    }
    for (const p of head.keys()) {
      if (!files.has(p)) out.push({ path: p, change: "deleted", mode: null });
    }
    return out;
  };

  const git: import("../../lib/worktree-move").MoveGit = {
    async readWorkingTree(cwd): Promise<WorkingTreeState | null> {
      if (cwd !== REPO && !cwd.startsWith(REPO + path.sep)) return null;
      return {
        toplevel: REPO,
        head: "abc123",
        branch: "main",
        uncommitted: changes().map((c) => ({
          path: c.path,
          status:
            c.change === "added" ? "??" : c.change === "deleted" ? " D" : " M",
        })),
        staged,
      };
    },
    async isValidBranchName(_cwd, branch) {
      return /^[\w][\w./-]*$/.test(branch) && !branch.includes("..");
    },
    async branchExists(_cwd, branch) {
      return branches.has(branch);
    },
    async suggestBranch(_cwd, name) {
      return `fix/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    },
    suggestFolder(repoName, branch) {
      return path.join(WT_ROOT, `${repoName}-${branch.replace(/\//g, "-")}`);
    },
    async snapshotForMove(_cwd, sessionId): Promise<MoveSnapshot> {
      check("snapshot");
      const ref = `refs/agent-os/${sessionId}/move-${snapshots.size}`;
      const paths = changes();
      snapshots.set(
        ref,
        new Map(paths.map((p) => [p.path, files.get(p.path) ?? null]))
      );
      log.push("snapshot");
      return {
        ref,
        commit: "c0ffee",
        tree: "7ree",
        head: "abc123",
        paths,
        skipped: [],
      };
    },
    async materialise(snapshot, _src, wt) {
      check("materialise");
      const tree = worktrees.get(wt)!;
      for (const [p, c] of snapshots.get(snapshot.ref)!) {
        if (c === null) tree.delete(p);
        else tree.set(p, c);
      }
      log.push("materialise");
    },
    async verifyMaterialised(snapshot, wt) {
      if (fail.has("verify")) return false;
      const tree = worktrees.get(wt)!;
      return [...snapshots.get(snapshot.ref)!].every(([p, c]) =>
        c === null ? !tree.has(p) : tree.get(p) === c
      );
    },
    async cleanSource(_cwd, snapshot) {
      // Half-way, then the failure: the rollback must still put it back
      for (const p of snapshot.paths) {
        if (head.has(p.path)) files.set(p.path, head.get(p.path)!);
        else files.delete(p.path);
        if (fail.has("clean")) throw new Error("injected: clean");
      }
      log.push("clean");
    },
    async restoreSource(_cwd, snapshot) {
      check("restore");
      for (const [p, c] of snapshots.get(snapshot.ref)!) {
        if (c === null) files.delete(p);
        else files.set(p, c);
      }
      log.push("restore");
    },
    async dropSnapshot(_cwd, snapshot) {
      snapshots.delete(snapshot.ref);
      log.push("drop");
    },
  };

  const createWorktree = async (
    o: import("../../lib/worktrees").CreateWorktreeOptions
  ) => {
    check("create");
    assert.equal(o.fromRef, "HEAD");
    assert.equal(o.branchName, o.featureName);
    fs.mkdirSync(o.worktreePath!, { recursive: true });
    branches.add(o.branchName!);
    worktrees.set(o.worktreePath!, new Map(head));
    log.push(`create ${o.branchName}`);
    return {};
  };
  const deleteWorktree = async (wt: string) => {
    fs.rmSync(wt, { recursive: true, force: true });
    worktrees.delete(wt);
    for (const b of [...branches]) if (b !== "main") branches.delete(b);
    log.push("delete worktree");
  };

  return {
    git,
    createWorktree,
    deleteWorktree,
    head,
    files,
    branches,
    worktrees,
    fail,
    log,
    setStaged: (on: boolean) => (staged = on),
    sourceSnapshot: () => new Map(files),
  };
}

/** Fake tmux, agent and clock around the real queue store and DB */
function harness(
  over: Partial<import("../../lib/worktree-move").WorktreeMoveDeps> = {}
) {
  const repo = fakeRepo();
  const running = new Set<string>();
  const dead = new Set<string>();
  const tmux: string[][] = [];
  const typed: { id: string; text: string }[] = [];
  const setups: string[] = [];
  const states = new Map<string, MoveState>();
  const reads = new Map<string, Readiness>();
  let clock = 1_000_000;
  /** Sessions whose relaunched agent never reaches its prompt */
  const neverReady = new Set<string>();
  /** Sessions whose Claude ignores /exit */
  const ignoresExit = new Set<string>();
  let others: { id: string; name: string }[] = [];
  let queueOn = true;
  let launches = 0;

  const nameOf = (target: string) => target.replace(/^=/, "").replace(/:$/, "");
  const idOf = (name: string) => name.replace(/^[a-z]+-/, "");

  const deps: import("../../lib/worktree-move").WorktreeMoveDeps = {
    db: db.getDb(),
    store: store.queueStore(),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    home: () => tmp,
    git: repo.git,
    createWorktree: repo.createWorktree,
    deleteWorktree: repo.deleteWorktree,
    exists: fs.existsSync,
    isRunning: async (s) => running.has(s.id),
    readiness: async (s) =>
      dead.has(s.id)
        ? { ready: false, holdReason: "unknown" }
        : (reads.get(s.id) ?? { ready: true, holdReason: null }),
    withLock: (_id, fn) => fn(),
    queueOn: () => queueOn,
    locateTranscript: async (s) =>
      s.claude_session_id
        ? {
            sessionId: s.claude_session_id,
            file: null,
            cwd: s.worktree_path || s.working_directory,
          }
        : null,
    copyTranscript: (sid, file, from, to) => {
      if (repo.fail.has("copy")) throw new Error("injected: copy");
      return mod.copyClaudeTranscript(
        process.env.CLAUDE_CONFIG_DIR!,
        sid,
        file,
        from,
        to
      );
    },
    otherSessions: async () => others,
    setup: (o) => setups.push(o.worktreePath),
    findPort: async () => 3456,
    tmux: async (args) => {
      tmux.push(args);
      const target = args[args.indexOf("-t") + 1] ?? "";
      const id = idOf(nameOf(target));
      if (args[0] === "display-message") {
        return { stdout: dead.has(id) ? "1\n" : "0\n" };
      }
      if (args[0] === "send-keys" && args.includes("C-c")) {
        if (!ignoresExit.has(id)) dead.add(id);
      }
      if (args[0] === "respawn-pane") {
        launches++;
        dead.delete(id);
        const cwd = args[args.indexOf("-c") + 1];
        if (neverReady.has(id) && cwd.startsWith(WT_ROOT)) {
          reads.set(id, { ready: false, holdReason: "unknown" });
        } else {
          reads.delete(id);
        }
      }
      if (args[0] === "new-session") {
        launches++;
        running.add(idOf(args[args.indexOf("-s") + 1]));
      }
      return { stdout: "" };
    },
    sendText: async (s, text) => {
      typed.push({ id: s.id, text });
      if (text === "/exit" && !ignoresExit.has(s.id)) dead.add(s.id);
    },
    launchCommand: async (s) => ({
      name: `claude-${s.id}`,
      cwd: s.working_directory,
      command: `claude${s.claude_session_id && s.agent_type === "claude" ? ` --resume ${s.claude_session_id}` : ""}`,
    }),
    summarize: async () => ({
      text: "Summary: haptics on each key press, arrow keys next",
      tokens: 9,
      filesChanged: ["KeyboardBar.swift"],
      plan: null,
      source: "scrollback",
      empty: false,
    }),
    states,
    ...over,
  };
  const m = mod.createWorktreeMove(deps);
  return {
    m,
    deps,
    repo,
    running,
    dead,
    tmux,
    typed,
    setups,
    states,
    reads,
    neverReady,
    ignoresExit,
    setOthers: (o: { id: string; name: string }[]) => (others = o),
    setQueueOn: (on: boolean) => (queueOn = on),
    launches: () => launches,
    busy: (id: string) => reads.set(id, { ready: false, holdReason: "busy" }),
    idle: (id: string) => reads.delete(id),
  };
}

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (error) {
    assert.ok(error instanceof mod.MoveRefused, String(error));
    return { status: error.status, ...error.body };
  }
  assert.fail("expected a refusal");
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const errors = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = errors;
  }
};

const BRANCH = "fix/keyboardbar-haptics";
const FOLDER = () => path.join(WT_ROOT, "keyboardbar-haptics");
const request = (over = {}) => ({
  branch: BRANCH,
  folder: FOLDER(),
  takeChanges: true,
  ...over,
});
const respawns = (h: ReturnType<typeof harness>) =>
  h.tmux.filter((a) => a[0] === "respawn-pane");
const MOVED_SOURCE = new Map([
  ["KeyboardBar.swift", "kb v1"],
  ["Haptics.swift", "h v1"],
  ["README.md", "readme"],
]);

describe("preview", () => {
  test("files, suggestion, folder, mode and nothing in the way", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.busy("a");
    const p = await h.m.movePreview(s);
    assert.deepEqual(p.uncommitted.map((f) => f.path).sort(), [
      "Haptics.swift",
      "KeyboardBar.swift",
      "New.swift",
      "README.md",
    ]);
    assert.equal(p.suggestedBranch, "fix/keyboardbar-haptics-a");
    assert.equal(
      p.folder,
      path.join(WT_ROOT, "repo-fix-keyboardbar-haptics-a")
    );
    assert.equal(p.folderDisplay, "~/worktrees/repo-fix-keyboardbar-haptics-a");
    assert.equal(p.repoName, "repo");
    assert.equal(p.currentBranch, "main");
    assert.equal(p.busy, true);
    assert.equal(p.mode, "resumed");
    assert.equal(p.refusal, null);
    assert.equal(p.pending, null);
  });

  test("why it can't move", async () => {
    const h = harness();
    const native = await h.m.movePreview(
      addSession("n", { branch_name: "feat" })
    );
    assert.equal(native.refusal?.reason, "native_worktree");
    const already = await h.m.movePreview(
      addSession("w", { worktree_path: "/tmp/wt", branch_name: "feat" })
    );
    assert.equal(already.refusal?.reason, "already_worktree");
    const paused = await h.m.movePreview(addSession("p", { paused_at: 5 }));
    assert.equal(paused.refusal?.reason, "paused");
    const outside = await h.m.movePreview(
      addSession("o", { working_directory: tmp })
    );
    assert.equal(outside.refusal?.reason, "not_git");
    const blank = await h.m.movePreview(
      addSession("b", { claude_session_id: null })
    );
    assert.equal(blank.refusal?.reason, "no_transcript");
    const codex = await h.m.movePreview(
      addSession("c", { claude_session_id: null, agent_type: "codex" })
    );
    assert.equal(codex.refusal, null);
    assert.equal(codex.mode, "handoff");
  });
});

describe("refusals", () => {
  test("staged, paused, native worktree, existing branch or folder", async () => {
    const h = harness();
    const s = addSession("a");
    h.repo.setStaged(true);
    assert.deepEqual(await refusal(h.m.moveToWorktree(s, request())), {
      status: 409,
      error: "Unstage or commit first",
      reason: "staged",
    });
    h.repo.setStaged(false);

    const paused = addSession("p", { paused_at: 5 });
    assert.equal(
      (await refusal(h.m.moveToWorktree(paused, request()))).reason,
      "paused"
    );
    const native = addSession("n", { branch_name: "feat" });
    assert.equal(
      (await refusal(h.m.moveToWorktree(native, request()))).status,
      400
    );

    h.repo.branches.add(BRANCH);
    assert.deepEqual(await refusal(h.m.moveToWorktree(s, request())), {
      status: 409,
      error: "That branch already exists",
      reason: "branch_exists",
    });
    h.repo.branches.delete(BRANCH);

    fs.mkdirSync(FOLDER());
    assert.equal(
      (await refusal(h.m.moveToWorktree(s, request()))).reason,
      "folder_exists"
    );
    fs.rmSync(FOLDER(), { recursive: true });

    for (const folder of ["relative/dir", path.join(REPO, "wt"), "~", "/"]) {
      assert.equal(
        (await refusal(h.m.moveToWorktree(s, request({ folder })))).reason,
        "bad_folder",
        folder
      );
    }
    for (const branch of ["", "bad..name", "-x"]) {
      assert.equal(
        (await refusal(h.m.moveToWorktree(s, request({ branch })))).reason,
        "bad_branch",
        branch
      );
    }
    assert.equal(h.repo.log.length, 0, "nothing touched");
    assert.equal(row("a")!.working_directory, REPO);
  });

  test("~/ folders resolve under home", async () => {
    const h = harness();
    const s = addSession("a");
    const r = await h.m.moveToWorktree(
      s,
      request({ folder: "~/worktrees/./keyboardbar-haptics" })
    );
    assert.equal(r.worktreePath, FOLDER());
  });

  test("a second move while one is scheduled", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.busy("a");
    const first = await h.m.moveToWorktree(s, request());
    assert.equal(first.scheduled, true);
    assert.deepEqual(
      await refusal(h.m.moveToWorktree(s, request({ branch: "other" }))),
      {
        status: 409,
        error: "A move is already scheduled or under way",
        reason: "in_progress",
      }
    );
  });
});

describe("busy: scheduled at the idle edge", () => {
  test("stored ahead of the user's messages, then run", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    store.queueStore().enqueue("a", { text: "queued", origin: "user" });
    h.busy("a");
    const r = await h.m.moveToWorktree(s, request());
    assert.equal(r.scheduled, true);
    assert.equal(r.worktreePath, FOLDER());
    assert.equal(r.session.working_directory, REPO, "nothing moved yet");
    assert.equal(h.repo.log.length, 0);
    assert.equal(moving.isMoving("a"), false, "not held while it waits");

    const q = store.queueStore();
    const head = q.head("a")!;
    assert.equal(head.kind, "move");
    assert.equal(head.origin, "system");
    assert.equal(head.position, 1);
    const payload = types.decodeMovePayload(head.text)!;
    assert.equal(payload.worktreePath, FOLDER());
    assert.deepEqual(
      q.listQueue("a").map((i) => [i.text, i.position]),
      [["queued", 1]],
      "the composer doesn't list it"
    );
    assert.equal(h.m.moveStateOf("a")?.phase, "scheduled");
    assert.equal(h.m.moveStateOf("a")?.queueItemId, head.id);

    // The idle edge: the dispatcher claims it and runs it
    h.idle("a");
    const item = q.claimNext("a")!;
    assert.equal(item.id, head.id);
    let held = false;
    const run = h.m.runScheduledMove(row("a")!, item);
    held = moving.isMoving("a");
    await run;
    assert.equal(held, true, "held from its first step");
    assert.equal(moving.isMoving("a"), false);
    assert.equal(row("a")!.worktree_path, FOLDER());
    assert.equal(h.m.moveStateOf("a"), null, "a finished move leaves no state");
  });

  test("cancel before it starts; after it starts it's started", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.busy("a");
    await h.m.moveToWorktree(s, request());
    assert.deepEqual(await h.m.cancelMove(s), { cancelled: true });
    assert.equal(h.m.moveStateOf("a"), null);
    assert.equal((await refusal(h.m.cancelMove(s))).reason, "not_scheduled");

    await h.m.moveToWorktree(s, request());
    store.queueStore().claimNext("a");
    assert.deepEqual(await refusal(h.m.cancelMove(s)), {
      status: 409,
      error: "The move has already started",
      reason: "started",
    });
  });

  test("a scheduled move that no longer fits fails, untouched", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.busy("a");
    await h.m.moveToWorktree(s, request());
    h.repo.setStaged(true);
    const item = store.queueStore().claimNext("a")!;
    await assert.rejects(h.m.runScheduledMove(row("a")!, item), /Unstage/);
    assert.equal(h.m.moveStateOf("a")?.phase, "failed");
    assert.equal(h.repo.log.length, 0);
  });
});

describe("the move (Claude: resumed)", () => {
  test("worktree, changes, clean source, transcript, row, relaunch", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    const before = row("a")!.updated_at;
    const r = await h.m.moveToWorktree(s, request());

    assert.equal(r.scheduled, false);
    assert.equal(r.mode, "resumed");
    assert.equal(r.sourceKept, false);
    // The changes went, the source is clean
    assert.deepEqual(h.repo.files, MOVED_SOURCE);
    assert.equal(h.repo.worktrees.get(FOLDER())!.get("New.swift"), "new");
    assert.equal(h.repo.worktrees.get(FOLDER())!.has("README.md"), false);
    // Claude was asked to exit at its prompt, then relaunched in place
    assert.deepEqual(h.typed[0], { id: "a", text: "/exit" });
    const [respawn] = respawns(h);
    assert.deepEqual(respawn.slice(0, 6), [
      "respawn-pane",
      "-k",
      "-t",
      "=claude-a:",
      "-c",
      FOLDER(),
    ]);
    assert.match(respawn[6], new RegExp(`--resume ${SID}`));
    // The row, in place, keeping its place in Now
    const moved = row("a")!;
    assert.equal(moved.working_directory, FOLDER());
    assert.equal(moved.worktree_path, FOLDER());
    assert.equal(moved.branch_name, BRANCH);
    assert.equal(moved.base_branch, "main");
    assert.equal(moved.dev_server_port, 3456);
    assert.equal(moved.claude_session_id, SID);
    assert.equal(moved.tmux_name, "claude-a");
    assert.equal(moved.updated_at, before);
    // Told where it is, ahead of anything queued
    const first = store.queueStore().listQueue("a")[0];
    assert.equal(first.origin, "system");
    assert.match(first.text, /moved from .* to the worktree/);
    // Setup steps for the new worktree
    assert.deepEqual(h.setups, [FOLDER()]);
    // The pane closes normally again
    assert.ok(
      h.tmux.some(
        (a) =>
          a[0] === "set-option" &&
          a.includes("-u") &&
          a.includes("remain-on-exit")
      )
    );
    const item = store.queueStore().moveItem("a");
    assert.equal(item, null, "its row is done");
  });

  test("the transcript is copied and the original stays", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    await h.m.moveToWorktree(s, request());
    for (const dir of [projectDir(REPO), projectDir(FOLDER())]) {
      assert.equal(
        fs.readFileSync(path.join(dir, `${SID}.jsonl`), "utf8"),
        '{"type":"user"}\n{"type":"assistant"}\n'
      );
      assert.ok(
        fs.existsSync(path.join(dir, SID, "subagents", "agent-1.jsonl"))
      );
    }
  });

  test("relaunch command from the real builder: --resume <sid>", async () => {
    const h = harness({ launchCommand: (s) => launch.buildLaunchCommand(s) });
    const s = addSession("a", {
      effort: "high",
      permission_mode: "acceptEdits",
    });
    h.running.add("a");
    await h.m.moveToWorktree(s, request());
    const [respawn] = respawns(h);
    assert.equal(respawn[respawn.indexOf("-c") + 1], FOLDER());
    const script = respawn[6].replace(/^bash /, "");
    const body = fs.readFileSync(script, "utf8");
    fs.rmSync(script, { force: true });
    const exec = body.split("\n").find((l) => l.startsWith("exec claude"))!;
    assert.match(exec, new RegExp(`--resume ${SID}`));
    assert.match(exec, /--model opus/);
    assert.match(exec, /--effort high/);
    assert.match(exec, /--permission-mode acceptEdits/);
  });

  test("C-c when /exit isn't taken", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.ignoresExit.add("a");
    // C-c ends it (the fake drops ignoresExit for C-c below)
    const tmux = h.deps.tmux;
    h.deps.tmux = async (args) => {
      if (args[0] === "send-keys") h.ignoresExit.delete("a");
      return tmux(args);
    };
    const m = mod.createWorktreeMove(h.deps);
    await m.moveToWorktree(s, request());
    assert.ok(h.tmux.some((a) => a[0] === "send-keys" && a.includes("C-c")));
    assert.equal(row("a")!.worktree_path, FOLDER());
  });

  test("not running: row and transcript move, nothing launched", async () => {
    const h = harness();
    const s = addSession("a");
    const r = await h.m.moveToWorktree(s, request());
    assert.equal(r.session.worktree_path, FOLDER());
    assert.equal(h.launches(), 0);
    assert.deepEqual(h.typed, []);
    assert.ok(fs.existsSync(path.join(projectDir(FOLDER()), `${SID}.jsonl`)));
  });

  test("queue off: the notice is typed in once it is ready", async () => {
    const h = harness();
    h.setQueueOn(false);
    const s = addSession("a");
    h.running.add("a");
    await h.m.moveToWorktree(s, request());
    assert.equal(h.typed.length, 2);
    assert.match(h.typed[1].text, /moved from/);
  });

  test("takeChanges off: the worktree starts from HEAD, the source keeps them", async () => {
    const h = harness();
    const s = addSession("a");
    const before = h.repo.sourceSnapshot();
    await h.m.moveToWorktree(s, request({ takeChanges: false }));
    assert.deepEqual(h.repo.files, before);
    assert.equal(
      h.repo.worktrees.get(FOLDER())!.get("KeyboardBar.swift"),
      "kb v1"
    );
  });

  test("another live session in the folder: copied, the source kept", async () => {
    const h = harness();
    h.setOthers([{ id: "b", name: "Other" }]);
    const s = addSession("a");
    h.running.add("a");
    const before = h.repo.sourceSnapshot();
    const r = await h.m.moveToWorktree(s, request());
    assert.equal(r.sourceKept, true);
    assert.deepEqual(h.repo.files, before, "not cleaned");
    assert.equal(
      h.repo.worktrees.get(FOLDER())!.get("KeyboardBar.swift"),
      "kb v2"
    );
  });
});

describe("rollback", () => {
  const expectUntouched = (
    h: ReturnType<typeof harness>,
    before: Map<string, string>
  ) => {
    assert.deepEqual(h.repo.files, before, "source restored");
    assert.equal(fs.existsSync(FOLDER()), false, "worktree removed");
    assert.equal(h.repo.branches.has(BRANCH), false, "branch removed");
    const r = row("a")!;
    assert.equal(r.working_directory, REPO);
    assert.equal(r.worktree_path, null);
    assert.equal(r.branch_name, null);
  };

  for (const step of ["create", "materialise", "verify", "clean"] as const) {
    test(`an injected failure at ${step}`, async () => {
      const h = harness();
      const s = addSession("a");
      h.running.add("a");
      const before = h.repo.sourceSnapshot();
      h.repo.fail.add(step);
      await quiet(() =>
        assert.rejects(h.m.moveToWorktree(s, request()), mod.MoveFailed)
      );
      expectUntouched(h, before);
      assert.deepEqual(h.typed, [], "Claude was never stopped");
      assert.equal(h.m.moveStateOf("a")?.phase, "failed");
      assert.equal(moving.isMoving("a"), false);
      if (step === "clean") assert.ok(h.repo.log.includes("restore"));
      const item = db
        .getDb()
        .prepare(`SELECT status, error FROM session_queue WHERE kind = 'move'`)
        .get() as { status: string; error: string };
      assert.equal(item.status, "failed");
      assert.match(item.error, /injected|match/);
    });
  }

  test("an injected failure at the transcript copy", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    const before = h.repo.sourceSnapshot();
    h.repo.fail.add("copy");
    await quiet(() =>
      assert.rejects(h.m.moveToWorktree(s, request()), /injected: copy/)
    );
    expectUntouched(h, before);
    // Claude had stopped: it is back in its folder with its conversation
    const [respawn] = respawns(h);
    assert.equal(respawn[respawn.indexOf("-c") + 1], REPO);
    assert.match(respawn[6], new RegExp(`--resume ${SID}`));
    assert.equal(
      fs.existsSync(path.join(projectDir(FOLDER()), `${SID}.jsonl`)),
      false
    );
    assert.ok(fs.existsSync(path.join(projectDir(REPO), `${SID}.jsonl`)));
  });

  test("Claude doesn't stop: nothing moved", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.ignoresExit.add("a");
    const before = h.repo.sourceSnapshot();
    await quiet(() =>
      assert.rejects(h.m.moveToWorktree(s, request()), /didn't stop/)
    );
    expectUntouched(h, before);
    assert.equal(respawns(h).length, 0, "it still runs: not relaunched");
  });

  test("relaunch never ready: row back, old folder resumed, worktree kept", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.neverReady.add("a");
    const before = h.repo.sourceSnapshot();
    const error = await quiet(() =>
      h.m.moveToWorktree(s, request()).then(
        () => assert.fail("expected a failure"),
        (e) => e
      )
    );
    assert.ok(error instanceof mod.MoveFailed);
    assert.equal(error.keptWorktree, FOLDER());
    assert.deepEqual(h.repo.files, before, "source restored");
    assert.ok(fs.existsSync(FOLDER()), "worktree kept for inspection");
    const r = row("a")!;
    assert.equal(r.working_directory, REPO);
    assert.equal(r.worktree_path, null);
    const [there, back] = respawns(h);
    assert.equal(there[there.indexOf("-c") + 1], FOLDER());
    assert.equal(back[back.indexOf("-c") + 1], REPO);
    assert.match(back[6], new RegExp(`--resume ${SID}`));
    const state = h.m.moveStateOf("a")!;
    assert.equal(state.phase, "failed");
    assert.equal(state.keptWorktree, FOLDER());
    assert.match(state.error!, /didn't reach its prompt/);
    // A failed move doesn't block the next one
    h.neverReady.delete("a");
    fs.rmSync(FOLDER(), { recursive: true });
    h.repo.branches.delete(BRANCH);
    await h.m.moveToWorktree(row("a")!, request());
    assert.equal(h.m.moveStateOf("a"), null);
  });

  test("a restart mid-move: failed, the source put back", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    // Cut off right after the clean: the process dies (the copy never returns)
    let cut: QueueItem | null = null;
    h.deps.copyTranscript = async () => {
      cut = store.queueStore().moveItem("a");
      throw new Error("process died");
    };
    const m = mod.createWorktreeMove(h.deps);
    await quiet(() => assert.rejects(m.moveToWorktree(s, request())));
    // What the row said at the time of the cut
    const payload = JSON.parse(cut!.text);
    assert.equal(payload.progress.cleaned, true);
    assert.equal(payload.progress.rowMoved, false);

    // Replay: the source as it was at the cut, then recover
    const q = store.queueStore();
    const replay = q.startMove("a", cut!.text)!;
    for (const p of ["KeyboardBar.swift", "Haptics.swift"]) {
      h.repo.files.set(p, h.repo.head.get(p)!);
    }
    h.repo.files.delete("New.swift");
    h.repo.files.set("README.md", "readme");
    const [failed] = q.failInterruptedMoves();
    assert.equal(failed.id, replay.id);
    await m.recoverMove(failed);
    assert.equal(h.repo.files.get("KeyboardBar.swift"), "kb v2");
    assert.equal(h.repo.files.get("New.swift"), "new");
    assert.equal(h.repo.files.has("README.md"), false);
    assert.equal(m.moveStateOf("a")?.error, "Cut off by a restart");
  });
});

describe("other agents: handoff in place", () => {
  test("a fresh agent in the worktree gets the summary first", async () => {
    const h = harness();
    const s = addSession("c", { agent_type: "codex", claude_session_id: null });
    h.running.add("c");
    const r = await h.m.moveToWorktree(s, request());
    assert.equal(r.mode, "handoff");
    assert.ok(!h.typed.some((t) => t.text === "/exit"), "no /exit for codex");
    const [respawn] = respawns(h);
    assert.ok(respawn.includes("-k"), "the old agent is killed by the respawn");
    assert.equal(respawn[respawn.indexOf("-c") + 1], FOLDER());
    assert.doesNotMatch(respawn[6], /--resume/);
    const first = store.queueStore().listQueue("c")[0];
    assert.match(first.text, /^Summary: haptics/);
    assert.equal(row("c")!.worktree_path, FOLDER());
  });

  test("queue off: the summary is typed in", async () => {
    const h = harness();
    h.setQueueOn(false);
    const s = addSession("c", { agent_type: "codex", claude_session_id: null });
    h.running.add("c");
    await h.m.moveToWorktree(s, request());
    assert.deepEqual(
      h.typed.map((t) => t.text.slice(0, 8)),
      ["Summary:"]
    );
  });
});

describe("listMoves", () => {
  test("scheduled, moving and failed; failed for an hour", async () => {
    const h = harness();
    const s = addSession("a");
    h.running.add("a");
    h.busy("a");
    await h.m.moveToWorktree(s, request());
    h.states.set("b", {
      sessionId: "b",
      phase: "failed",
      branch: "x",
      worktreePath: "/x",
      takeChanges: true,
      mode: "resumed",
      queueItemId: null,
      at: h.deps.now(),
      error: "boom",
      keptWorktree: null,
    });
    assert.deepEqual(
      h.m
        .listMoves()
        .map((m) => [m.sessionId, m.phase])
        .sort(),
      [
        ["a", "scheduled"],
        ["b", "failed"],
      ]
    );
    await h.deps.sleep(60 * 60 * 1000 + 1);
    assert.deepEqual(
      h.m.listMoves().map((m) => m.sessionId),
      ["a"]
    );
  });
});

describe("copyClaudeTranscript", () => {
  test("replaces a stale copy of the same conversation", async () => {
    const root = process.env.CLAUDE_CONFIG_DIR!;
    const to = path.join(tmp, "elsewhere");
    fs.mkdirSync(path.join(projectDir(to), SID, "old"), { recursive: true });
    fs.writeFileSync(path.join(projectDir(to), `${SID}.jsonl`), "stale");
    fs.writeFileSync(path.join(projectDir(to), SID, "old", "x"), "stale");
    const written = await mod.copyClaudeTranscript(root, SID, null, REPO, to);
    assert.equal(written.length, 2);
    assert.equal(
      fs.readFileSync(path.join(projectDir(to), `${SID}.jsonl`), "utf8"),
      '{"type":"user"}\n{"type":"assistant"}\n'
    );
    assert.equal(fs.existsSync(path.join(projectDir(to), SID, "old")), false);
  });

  test("no transcript: refused", async () => {
    const root = process.env.CLAUDE_CONFIG_DIR!;
    await assert.rejects(
      mod.copyClaudeTranscript(root, "missing", null, REPO, FOLDER()),
      /hasn't written/
    );
  });
});
