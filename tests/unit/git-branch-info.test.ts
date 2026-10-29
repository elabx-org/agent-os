import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  forgetBranchInfo,
  getBranchInfo,
  NO_BRANCH_INFO,
} from "../../lib/git-branch-info";
import { getCommitHistory, resolveHistoryRef } from "../../lib/git-history";
import { g, tmpDir, write } from "./turns-fixture";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});
// Each step changes the repo: no 5s cache between them
beforeEach(() => forgetBranchInfo());

function identity(repo: string) {
  g(repo, "config", "user.email", "test@example.com");
  g(repo, "config", "user.name", "Test");
  g(repo, "config", "commit.gpgsign", "false");
}

function commit(repo: string, file: string, text: string, msg = file) {
  write(repo, file, text);
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", msg);
}

/** A bare remote whose default is `base`, and a clone of it (origin/HEAD set) */
function remoteAndClone(base = "main") {
  const remote = tmpDir("remote");
  const seed = tmpDir("seed");
  const clone = tmpDir("clone");
  dirs.push(remote, seed, clone);
  g(remote, "init", "-q", "--bare", "-b", base);
  g(seed, "init", "-q", "-b", base);
  identity(seed);
  commit(seed, "a.txt", "alpha\n", "init");
  g(seed, "remote", "add", "origin", remote);
  g(seed, "push", "-q", "-u", "origin", base);
  g(clone, "clone", "-q", remote, ".");
  identity(clone);
  return { remote, seed, clone };
}

test("getBranchInfo: a folder outside git gets NO_BRANCH_INFO", async () => {
  const dir = tmpDir("plain");
  dirs.push(dir);
  assert.deepEqual(await getBranchInfo(dir), NO_BRANCH_INFO);
  assert.deepEqual(
    await getBranchInfo(`${dir}/does-not-exist`),
    NO_BRANCH_INFO
  );
});

test("getBranchInfo: on the base branch, in step with origin", async () => {
  const { clone } = remoteAndClone();
  assert.deepEqual(await getBranchInfo(clone), {
    baseBranch: "main",
    aheadOfBase: 0,
    behindBase: 0,
    pushed: true,
  });
});

test("getBranchInfo: a branch ahead of the base, then pushed, then ahead of its upstream", async () => {
  const { clone } = remoteAndClone();
  g(clone, "checkout", "-q", "-b", "feature/x");
  commit(clone, "b.txt", "bravo\n");
  commit(clone, "c.txt", "charlie\n");
  // No upstream yet: not pushed
  assert.deepEqual(await getBranchInfo(clone), {
    baseBranch: "main",
    aheadOfBase: 2,
    behindBase: 0,
    pushed: false,
  });

  g(clone, "push", "-q", "-u", "origin", "feature/x");
  forgetBranchInfo(clone);
  assert.equal((await getBranchInfo(clone)).pushed, true);

  commit(clone, "d.txt", "delta\n");
  forgetBranchInfo(clone);
  const info = await getBranchInfo(clone);
  assert.equal(info.aheadOfBase, 3);
  assert.equal(info.pushed, false);
});

test("getBranchInfo: behind origin's base, on a branch and on the base itself", async () => {
  const { seed, clone } = remoteAndClone();
  g(clone, "checkout", "-q", "-b", "feature/y");
  commit(clone, "b.txt", "bravo\n");
  commit(seed, "e.txt", "echo\n");
  g(seed, "push", "-q");
  g(clone, "fetch", "-q");

  assert.deepEqual(await getBranchInfo(clone), {
    baseBranch: "main",
    aheadOfBase: 1,
    behindBase: 1,
    pushed: false,
  });

  // On main itself the counts are against origin/main
  g(clone, "checkout", "-q", "main");
  forgetBranchInfo(clone);
  const onBase = await getBranchInfo(clone);
  assert.equal(onBase.baseBranch, "main");
  assert.equal(onBase.aheadOfBase, 0);
  assert.equal(onBase.behindBase, 1);
  // Its upstream is origin/main, which has nothing HEAD lacks
  assert.equal(onBase.pushed, true);
});

test("getBranchInfo: origin's default wins over main/master", async () => {
  const { clone } = remoteAndClone("trunk");
  g(clone, "branch", "main");
  g(clone, "checkout", "-q", "-b", "work");
  commit(clone, "w.txt", "work\n");
  const info = await getBranchInfo(clone);
  assert.equal(info.baseBranch, "trunk");
  assert.equal(info.aheadOfBase, 1);
});

test("getBranchInfo: a local repo without origin falls back to main, else master, else null", async () => {
  const repo = tmpDir("local");
  dirs.push(repo);
  g(repo, "init", "-q", "-b", "master");
  identity(repo);
  commit(repo, "a.txt", "alpha\n");
  g(repo, "checkout", "-q", "-b", "topic");
  commit(repo, "b.txt", "bravo\n");
  assert.deepEqual(await getBranchInfo(repo), {
    baseBranch: "master",
    aheadOfBase: 1,
    behindBase: 0,
    pushed: false,
  });

  g(repo, "branch", "-q", "-m", "master", "dev");
  forgetBranchInfo(repo);
  assert.deepEqual(await getBranchInfo(repo), NO_BRANCH_INFO);
});

test("getBranchInfo: an unborn HEAD counts nothing", async () => {
  const repo = tmpDir("unborn");
  dirs.push(repo);
  g(repo, "init", "-q", "-b", "main");
  assert.deepEqual(await getBranchInfo(repo), NO_BRANCH_INFO);
});

test("getBranchInfo: answers from its cache for a few seconds", async () => {
  const { clone } = remoteAndClone();
  const first = await getBranchInfo(clone);
  commit(clone, "z.txt", "zulu\n");
  assert.equal(await getBranchInfo(clone), first);
  forgetBranchInfo(clone);
  assert.equal((await getBranchInfo(clone)).pushed, false);
});

test("history ref: HEAD's history by default, main's when asked, origin's copy when main isn't local", async () => {
  const { clone } = remoteAndClone();
  g(clone, "checkout", "-q", "-b", "feature/h");
  commit(clone, "h.txt", "hotel\n", "Add hotel");

  const head = await getCommitHistory(clone, 10);
  assert.deepEqual(
    head.map((c) => c.subject),
    ["Add hotel", "init"]
  );
  assert.equal(head[0].filesChanged, 1);
  assert.equal(head[0].additions, 1);

  const mainRef = await resolveHistoryRef(clone, "main");
  assert.equal(mainRef, "refs/heads/main");
  const main = await getCommitHistory(clone, 10, mainRef!);
  assert.deepEqual(
    main.map((c) => c.subject),
    ["init"]
  );

  g(clone, "branch", "-q", "-D", "main");
  assert.equal(
    await resolveHistoryRef(clone, "main"),
    "refs/remotes/origin/main"
  );
  // A hash still works
  assert.equal(await resolveHistoryRef(clone, head[1].hash), head[1].hash);
});

test("history ref: unknown refs and options are refused", async () => {
  const { clone } = remoteAndClone();
  assert.equal(await resolveHistoryRef(clone, "no-such-branch"), null);
  assert.equal(await resolveHistoryRef(clone, "--all"), null);
  assert.equal(await resolveHistoryRef(clone, "-n1"), null);
  assert.equal(await resolveHistoryRef(clone, "main two"), null);
  assert.equal(await resolveHistoryRef(clone, ""), null);
});
