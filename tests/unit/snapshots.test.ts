import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { snapshot } from "../../lib/snapshots";
import {
  agentRefs,
  g,
  makeRepo,
  tmpDir,
  userState,
  write,
} from "./turns-fixture";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const root = makeRepo();
  dirs.push(root);
  return root;
}

function treeFiles(root: string, ref: string): string[] {
  return g(root, "ls-tree", "-r", "--name-only", ref)
    .split("\n")
    .filter(Boolean);
}

describe("snapshot", () => {
  test("pre and post refs hold the working tree, user state untouched", async () => {
    const root = repo();
    const before = userState(root);

    const pre = await snapshot(root, "s1", 1, "pre");
    assert.equal(pre, "refs/agent-os/s1/t1-pre");
    // The working file, not the staged one
    assert.equal(
      g(root, "show", `${pre}:c.txt`),
      "charlie staged then edited\n"
    );
    const files = treeFiles(root, pre!);
    assert.ok(files.includes("untracked.txt"), "untracked files are in it");
    assert.ok(!files.includes("ignored/x.txt"), "ignored files are not");
    assert.ok(!files.includes("notes.log"));

    write(root, "a.txt", "alpha changed\n");
    const post = await snapshot(root, "s1", 1, "post");
    assert.equal(post, "refs/agent-os/s1/t1-post");
    assert.equal(g(root, "show", `${post}:a.txt`), "alpha changed\n");
    // Chained on the session's previous snapshot
    assert.equal(
      g(root, "rev-parse", `${post}^`).trim(),
      g(root, "rev-parse", pre!).trim()
    );
    const after = userState(root);
    assert.deepEqual({ ...after, status: "" }, { ...before, status: "" });
    // The only status change is the edit made between the two snapshots
    write(root, "a.txt", "alpha\n");
    assert.equal(userState(root).status, before.status);
    assert.match(after.status, / M a\.txt/);
  });

  test("index, HEAD, stash, branches and status identical across snapshots", async () => {
    const root = repo();
    write(root, "b.txt", "stashed\n");
    g(root, "stash", "push", "-q", "--", "b.txt");
    const before = userState(root);
    for (let n = 1; n <= 3; n++) {
      assert.ok(await snapshot(root, "s2", n, "pre"));
      assert.ok(await snapshot(root, "s2", n, "post"));
    }
    assert.deepEqual(userState(root), before);
    assert.equal(agentRefs(root, "s2").length, 6);
    // Nothing in the user's own namespaces
    assert.equal(g(root, "for-each-ref", "refs/heads").split("\n").length, 3);
  });

  test("untracked files over 5MB are left out, smaller ones kept", async () => {
    const root = repo();
    write(root, "big.bin", Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    write(root, "small.bin", Buffer.alloc(1024, 1));
    const before = userState(root);
    const ref = await snapshot(root, "s3", 1, "pre");
    const files = treeFiles(root, ref!);
    assert.ok(!files.includes("big.bin"));
    assert.ok(files.includes("small.bin"));
    assert.deepEqual(userState(root), before);
  });

  test("a non-git folder gives null", async () => {
    const dir = tmpDir("plain");
    dirs.push(dir);
    assert.equal(await snapshot(dir, "s4", 1, "pre"), null);
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  test("bad ids and turn numbers give null", async () => {
    const root = repo();
    assert.equal(await snapshot(root, "../x", 1, "pre"), null);
    assert.equal(await snapshot(root, "s5", 0, "pre"), null);
    assert.equal(agentRefs(root, "s5").length, 0);
  });

  test("past the deadline: null, and the next one still works", async () => {
    const root = repo();
    assert.equal(await snapshot(root, "s6", 1, "pre", { timeoutMs: 1 }), null);
    assert.ok(await snapshot(root, "s6", 1, "pre"));
  });

  test("a linked worktree has its own private index; refs are shared", async () => {
    const root = repo();
    const wt = path.join(tmpDir("wt"), "tree");
    dirs.push(path.dirname(wt));
    g(root, "worktree", "add", "-q", wt, "side");
    write(wt, "a.txt", "alpha in worktree\n");
    g(wt, "add", "a.txt");
    const mainBefore = userState(root);
    const wtBefore = userState(wt);

    const ref = await snapshot(wt, "s7", 1, "pre");
    assert.ok(ref);
    assert.equal(g(root, "show", `${ref}:a.txt`), "alpha in worktree\n");
    const gitDir = g(wt, "rev-parse", "--absolute-git-dir").trim();
    assert.ok(fs.existsSync(path.join(gitDir, "agent-os", "index-s7")));
    assert.deepEqual(userState(root), mainBefore);
    assert.deepEqual(userState(wt), wtBefore);
  });

  test("a subfolder cwd snapshots the whole repo", async () => {
    const root = repo();
    write(root, "a.txt", "from the top\n");
    const ref = await snapshot(path.join(root, "src"), "s8", 1, "pre");
    assert.equal(g(root, "show", `${ref}:a.txt`), "from the top\n");
  });
});

// Plan 0.5: warm `pre` p95 < 1s, cold < 3s on the agent-os repo. A clone
// under /tmp, so no ref is ever written into the real repository
const AGENT_OS = "/config/workspace/gh/agent-os";
describe("snapshot performance", { skip: !fs.existsSync(AGENT_OS) }, () => {
  test("cold < 3s, warm p95 < 1s on a clone of agent-os", async () => {
    const root = path.join(tmpDir("perf"), "agent-os");
    dirs.push(path.dirname(root));
    g(path.dirname(root), "clone", "-q", "--single-branch", AGENT_OS, root);
    write(root, "scratch/new.txt", "x\n");

    let t = Date.now();
    assert.ok(await snapshot(root, "perf", 1, "pre", { timeoutMs: 10_000 }));
    const cold = Date.now() - t;

    const warm: number[] = [];
    for (let n = 2; n <= 21; n++) {
      write(root, "scratch/new.txt", `${n}\n`);
      t = Date.now();
      assert.ok(await snapshot(root, "perf", n, "pre", { timeoutMs: 10_000 }));
      warm.push(Date.now() - t);
    }
    warm.sort((a, b) => a - b);
    const p95 = warm[Math.ceil(warm.length * 0.95) - 1];
    console.log(`snapshot perf: cold ${cold}ms, warm p95 ${p95}ms`);
    assert.ok(cold < 3000, `cold ${cold}ms`);
    assert.ok(p95 < 1000, `warm p95 ${p95}ms`);
  });
});
