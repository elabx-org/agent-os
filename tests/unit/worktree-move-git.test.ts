import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { g, makeRepo, read, tmpDir, write } from "./turns-fixture";

// lib/worktrees.ts reads the home folder once, at load: point it at a temp one
const home = tmpDir("move-home");
process.env.HOME = home;

type Git = typeof import("../../lib/worktree-move-git");
type Worktrees = typeof import("../../lib/worktrees");
let mg: Git;
let wt: Worktrees;

const dirs: string[] = [home];
before(async () => {
  mg = await import("../../lib/worktree-move-git");
  wt = await import("../../lib/worktrees");
});
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A committed repo with the tracked files the move tests change */
function repo(): string {
  const root = tmpDir("move");
  dirs.push(root);
  g(root, "init", "-q", "-b", "main");
  g(root, "config", "user.email", "test@example.com");
  g(root, "config", "user.name", "Test");
  g(root, "config", "commit.gpgsign", "false");
  write(root, "a.txt", "alpha\n");
  write(root, "b.txt", "bravo\n");
  write(root, "gone.txt", "to delete\n");
  write(root, "src/keep.ts", "export const k = 1;\n");
  write(root, "run.sh", "#!/bin/sh\necho hi\n");
  fs.chmodSync(path.join(root, "run.sh"), 0o755);
  fs.symlinkSync("a.txt", path.join(root, "link"));
  write(root, ".gitignore", "ignored/\n*.log\n");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "init");
  return root;
}

/** Changes of every kind, with awkward names */
function dirty(root: string) {
  write(root, "a.txt", "alpha changed\n");
  fs.rmSync(path.join(root, "gone.txt"));
  write(root, "new dir/naïve file.txt", "untracked ünïcode\n");
  write(root, "deep/er/x.txt", "nested untracked\n");
  write(root, "ignored/secret.txt", "ignored\n");
  write(root, "notes.log", "log\n");
  write(root, "tool.sh", "#!/bin/sh\necho tool\n");
  fs.chmodSync(path.join(root, "tool.sh"), 0o755);
  fs.chmodSync(path.join(root, "b.txt"), 0o755);
  fs.symlinkSync("src/keep.ts", path.join(root, "newlink"));
  fs.rmSync(path.join(root, "link"));
  fs.symlinkSync("b.txt", path.join(root, "link"));
}

function indexHash(root: string): { hash: string; mtime: number } {
  const file = path.join(root, ".git", "index");
  return {
    hash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    mtime: fs.statSync(file).mtimeMs,
  };
}

function status(root: string): string {
  return g(root, "status", "--porcelain", "--untracked-files=all");
}

function head(root: string): string {
  return g(root, "rev-parse", "HEAD").trim();
}

/** Every non-ignored file's bytes, mode and link target */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      // The ignored ones are not the move's business
      if (name === ".git" || name === "ignored" || name.endsWith(".log"))
        continue;
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(abs)}`;
      else if (st.isDirectory()) walk(abs);
      else
        out[rel] =
          `${(st.mode & 0o111 ? "x:" : "-:") + fs.readFileSync(abs, "hex")}`;
    }
  };
  walk(root);
  return out;
}

async function addWorktree(root: string, name: string): Promise<string> {
  const folder = path.join(tmpDir("wt"), name);
  dirs.push(path.dirname(folder));
  await wt.createWorktree({
    projectPath: root,
    featureName: name,
    branchName: `feat/${name}`,
    worktreePath: folder,
    fromRef: "HEAD",
  });
  return folder;
}

describe("readWorkingTree", () => {
  test("lists untracked, leaves ignored out, reads branch and HEAD", async () => {
    const root = repo();
    dirty(root);
    const state = await mg.readWorkingTree(root);
    assert.ok(state);
    assert.equal(state.toplevel, fs.realpathSync(root));
    assert.equal(state.head, head(root));
    assert.equal(state.branch, "main");
    assert.equal(state.staged, false);
    const byPath = Object.fromEntries(
      state.uncommitted.map((f) => [f.path, f.status])
    );
    assert.equal(byPath["a.txt"], " M");
    assert.equal(byPath["gone.txt"], " D");
    assert.equal(byPath["new dir/naïve file.txt"], "??");
    assert.equal(byPath["deep/er/x.txt"], "??");
    assert.ok(!("notes.log" in byPath));
    assert.ok(!Object.keys(byPath).some((p) => p.startsWith("ignored")));
  });

  test("staged changes are detected; detached HEAD has no branch", async () => {
    const root = repo();
    write(root, "a.txt", "staged\n");
    g(root, "add", "a.txt");
    assert.equal((await mg.readWorkingTree(root))?.staged, true);
    g(root, "reset", "-q");
    write(root, "itа.txt", "intent\n");
    g(root, "add", "-N", "itа.txt");
    assert.equal((await mg.readWorkingTree(root))?.staged, true);
    g(root, "rm", "-q", "--cached", "itа.txt");
    g(root, "checkout", "-q", "--detach");
    const state = await mg.readWorkingTree(root);
    assert.equal(state?.staged, false);
    assert.equal(state?.branch, null);
  });

  test("null outside git", async () => {
    const dir = tmpDir("nogit");
    dirs.push(dir);
    assert.equal(await mg.readWorkingTree(dir), null);
  });
});

describe("branch and folder names", () => {
  test("isValidBranchName", async () => {
    const root = repo();
    assert.equal(await mg.isValidBranchName(root, "fix/keyboardbar"), true);
    assert.equal(await mg.isValidBranchName(root, "bad..name"), false);
    assert.equal(await mg.isValidBranchName(root, "-x"), false);
    assert.equal(await mg.isValidBranchName(root, "has space"), false);
    assert.equal(await mg.isValidBranchName(root, "@{-1}"), false);
    assert.equal(await mg.isValidBranchName(root, ""), false);
  });

  test("suggestBranch picks the next free suffix", async () => {
    const root = repo();
    const name = "Fix KeyboardBar haptics";
    assert.equal(await mg.suggestBranch(root, name), "fix/keyboardbar-haptics");
    g(root, "branch", "fix/keyboardbar-haptics");
    assert.equal(
      await mg.suggestBranch(root, name),
      "fix/keyboardbar-haptics-2"
    );
    g(root, "branch", "fix/keyboardbar-haptics-2");
    assert.equal(
      await mg.suggestBranch(root, name),
      "fix/keyboardbar-haptics-3"
    );
    assert.equal(await mg.suggestBranch(root, "   "), "feature/move");
  });

  test("suggestFolder is under the worktrees folder, next free -N", () => {
    const base = wt.getWorktreesDir();
    assert.ok(base.startsWith(home));
    const first = mg.suggestFolder("agent-os", "fix/keyboardbar-haptics");
    assert.equal(first, path.join(base, "agent-os-keyboardbar-haptics"));
    fs.mkdirSync(first, { recursive: true });
    assert.equal(
      mg.suggestFolder("agent-os", "fix/keyboardbar-haptics"),
      `${first}-2`
    );
    fs.mkdirSync(`${first}-2`);
    assert.equal(
      mg.suggestFolder("agent-os", "fix/keyboardbar-haptics"),
      `${first}-3`
    );
  });
});

describe("createWorktree with exact branch, folder and start", () => {
  test("starts at HEAD, unpushed commits included; refuses existing branch and folder", async () => {
    const root = repo();
    // A bare remote whose main is behind the local branch
    const remote = tmpDir("remote");
    dirs.push(remote);
    g(remote, "init", "-q", "--bare");
    g(root, "remote", "add", "origin", remote);
    g(root, "push", "-q", "origin", "main");
    g(root, "checkout", "-q", "-b", "work");
    write(root, "local.txt", "unpushed\n");
    g(root, "add", "local.txt");
    g(root, "commit", "-q", "-m", "local only");

    const parent = tmpDir("wtparent");
    dirs.push(parent);
    const folder = path.join(parent, "nested", "my wt");
    const info = await wt.createWorktree({
      projectPath: root,
      featureName: "ignored here",
      branchName: "fix/exact",
      worktreePath: folder,
      fromRef: "HEAD",
    });
    assert.equal(info.branchName, "fix/exact");
    assert.equal(info.worktreePath, folder);
    assert.equal(head(folder), head(root));
    assert.equal(read(folder, "local.txt"), "unpushed\n");
    assert.equal(
      g(folder, "rev-parse", "--abbrev-ref", "HEAD").trim(),
      "fix/exact"
    );

    await assert.rejects(
      wt.createWorktree({
        projectPath: root,
        featureName: "x",
        branchName: "fix/exact",
        worktreePath: path.join(parent, "other"),
        fromRef: "HEAD",
      }),
      /Branch already exists/
    );
    await assert.rejects(
      wt.createWorktree({
        projectPath: root,
        featureName: "x",
        branchName: "fix/fresh",
        worktreePath: folder,
        fromRef: "HEAD",
      }),
      /already exists/
    );
    await assert.rejects(
      wt.createWorktree({
        projectPath: root,
        featureName: "x",
        branchName: "bad..name",
        worktreePath: path.join(parent, "bad"),
        fromRef: "HEAD",
      }),
      /Invalid branch name/
    );
    // Nothing made for the refused ones
    assert.ok(!fs.existsSync(path.join(parent, "other")));
    assert.equal(
      g(root, "branch", "--list", "fix/fresh").trim(),
      "",
      "no branch left behind"
    );
  });

  test("without the new options, today's behaviour", async () => {
    const root = repo();
    const info = await wt.createWorktree({
      projectPath: root,
      featureName: "Old style",
      baseBranch: "main",
    });
    dirs.push(info.worktreePath);
    assert.equal(info.branchName, "feature/old-style");
    assert.ok(info.worktreePath.startsWith(wt.getWorktreesDir()));
    assert.equal(head(info.worktreePath), head(root));
  });
});

describe("snapshot, materialise, clean, restore", () => {
  test("the snapshot carries modified, added, untracked and deleted, not ignored", async () => {
    const root = repo();
    dirty(root);
    const before = indexHash(root);
    const headBefore = head(root);
    const snap = await mg.snapshotForMove(root, "s1");
    assert.match(snap.ref, /^refs\/agent-os\/s1\/move-\d+$/);
    assert.equal(snap.head, headBefore);
    assert.equal(g(root, "rev-parse", snap.ref).trim(), snap.commit);
    assert.equal(g(root, "rev-parse", `${snap.commit}^`).trim(), headBefore);
    assert.deepEqual(snap.skipped, []);
    const byPath = Object.fromEntries(snap.paths.map((p) => [p.path, p]));
    assert.deepEqual(byPath["a.txt"], {
      path: "a.txt",
      change: "modified",
      mode: "100644",
    });
    assert.equal(byPath["b.txt"].mode, "100755");
    assert.equal(byPath["gone.txt"].change, "deleted");
    assert.equal(byPath["gone.txt"].mode, null);
    assert.equal(byPath["new dir/naïve file.txt"].change, "added");
    assert.equal(byPath["deep/er/x.txt"].change, "added");
    assert.equal(byPath["tool.sh"].mode, "100755");
    assert.equal(byPath["newlink"].mode, "120000");
    assert.equal(byPath["link"].change, "modified");
    assert.ok(!byPath["notes.log"]);
    assert.ok(!Object.keys(byPath).some((p) => p.startsWith("ignored")));
    // The user's index and HEAD are untouched
    assert.deepEqual(indexHash(root), before);
    assert.equal(head(root), headBefore);

    await mg.dropSnapshot(root, snap);
    assert.equal(
      g(root, "for-each-ref", "refs/agent-os").trim(),
      "",
      "ref dropped"
    );
  });

  test("seeded from HEAD, not the user's index", async () => {
    const root = repo();
    write(root, "a.txt", "staged version\n");
    g(root, "add", "a.txt");
    write(root, "a.txt", "work tree version\n");
    const snap = await mg.snapshotForMove(root, "s2");
    assert.equal(g(root, "show", `${snap.tree}:a.txt`), "work tree version\n");
  });

  test("large untracked files are listed in skipped, and block cleaning", async () => {
    const root = repo();
    const big = path.join(root, "big.bin");
    const fd = fs.openSync(big, "w");
    fs.ftruncateSync(fd, 50 * 1024 * 1024 + 1);
    fs.closeSync(fd);
    write(root, "a.txt", "changed\n");
    const snap = await mg.snapshotForMove(root, "s3");
    assert.deepEqual(snap.skipped, ["big.bin"]);
    assert.ok(!snap.paths.some((p) => p.path === "big.bin"));
    await assert.rejects(mg.cleanSource(root, snap), /left out/);
    assert.equal(read(root, "a.txt"), "changed\n");
  });

  test("full move: materialise + verify, clean source, restore exact bytes", async () => {
    const root = repo();
    dirty(root);
    const dirtyTree = tree(root);
    const snap = await mg.snapshotForMove(root, "s4");

    const folder = await addWorktree(root, "move");
    await mg.materialise(snap, root, folder);
    assert.equal(await mg.verifyMaterialised(snap, folder), true);
    assert.deepEqual(tree(folder), dirtyTree, "worktree holds the changes");
    // The worktree's own index still matches HEAD: changes are uncommitted
    assert.equal(g(folder, "diff", "--cached", "--name-only").trim(), "");
    assert.match(status(folder), /^ M a\.txt$/m);
    assert.match(status(folder), /^\?\? tool\.sh$/m);
    assert.ok(!fs.existsSync(path.join(folder, "ignored")));

    const indexBefore = indexHash(root);
    const headBefore = head(root);
    await mg.cleanSource(root, snap);
    assert.deepEqual(indexHash(root), indexBefore, "user index untouched");
    assert.equal(head(root), headBefore);
    assert.equal(status(root), "", "source left clean");
    assert.ok(!fs.existsSync(path.join(root, "deep")), "empty folders gone");
    assert.ok(!fs.existsSync(path.join(root, "new dir")));
    assert.equal(fs.readlinkSync(path.join(root, "link")), "a.txt");
    assert.equal(fs.statSync(path.join(root, "b.txt")).mode & 0o111, 0);
    // Ignored files are not the move's business
    assert.equal(read(root, "ignored/secret.txt"), "ignored\n");
    assert.equal(read(root, "notes.log"), "log\n");

    await mg.restoreSource(root, snap);
    assert.deepEqual(tree(root), dirtyTree, "exact bytes, modes and links");
    assert.deepEqual(indexHash(root), indexBefore);
  });

  test("verify fails when the worktree differs", async () => {
    const root = repo();
    dirty(root);
    const snap = await mg.snapshotForMove(root, "s5");
    const folder = await addWorktree(root, "verify");
    await mg.materialise(snap, root, folder);
    fs.chmodSync(path.join(folder, "tool.sh"), 0o644);
    assert.equal(await mg.verifyMaterialised(snap, folder), false);
    fs.chmodSync(path.join(folder, "tool.sh"), 0o755);
    write(folder, "gone.txt", "back\n");
    assert.equal(await mg.verifyMaterialised(snap, folder), false);
    fs.rmSync(path.join(folder, "gone.txt"));
    write(folder, "a.txt", "different\n");
    assert.equal(await mg.verifyMaterialised(snap, folder), false);
  });

  test("a failed materialise leaves the source untouched", async () => {
    const root = repo();
    dirty(root);
    const snap = await mg.snapshotForMove(root, "s6");
    const sourceBefore = tree(root);
    const indexBefore = indexHash(root);
    const statusBefore = status(root);
    // Injected failure: a worktree that is not at the snapshot's HEAD
    const folder = await addWorktree(root, "behind");
    write(folder, "extra.txt", "x\n");
    g(folder, "add", "extra.txt");
    g(folder, "commit", "-q", "-m", "moves the worktree on");
    await assert.rejects(mg.materialise(snap, root, folder), /Worktree is at/);
    assert.deepEqual(tree(root), sourceBefore);
    assert.deepEqual(indexHash(root), indexBefore);
    assert.equal(status(root), statusBefore);
  });

  test("cleanSource refuses when staged changes appear or HEAD moves", async () => {
    const root = repo();
    write(root, "a.txt", "changed\n");
    const snap = await mg.snapshotForMove(root, "s7");
    write(root, "b.txt", "staged later\n");
    g(root, "add", "b.txt");
    await assert.rejects(mg.cleanSource(root, snap), /Staged/);
    assert.equal(read(root, "a.txt"), "changed\n");
    g(root, "commit", "-q", "-m", "moves HEAD");
    await assert.rejects(mg.cleanSource(root, snap), /HEAD moved/);
  });

  test("a deleted file replaced by a folder round-trips", async () => {
    const root = repo();
    fs.rmSync(path.join(root, "gone.txt"));
    write(root, "gone.txt/inside.txt", "now a folder\n");
    const snapped = tree(root);
    const snap = await mg.snapshotForMove(root, "s8");
    const folder = await addWorktree(root, "df");
    await mg.materialise(snap, root, folder);
    assert.deepEqual(tree(folder), snapped);
    await mg.cleanSource(root, snap);
    assert.equal(status(root), "");
    assert.equal(read(root, "gone.txt"), "to delete\n");
    await mg.restoreSource(root, snap);
    assert.deepEqual(tree(root), snapped);
  });

  test("works on the shared fixture repo too", async () => {
    const root = makeRepo();
    dirs.push(root);
    g(root, "reset", "-q"); // the fixture stages c.txt; moves refuse that
    const snap = await mg.snapshotForMove(root, "s9");
    const folder = await addWorktree(root, "fixture");
    await mg.materialise(snap, root, folder);
    await mg.cleanSource(root, snap);
    assert.equal(status(root), "");
    assert.equal(read(folder, "untracked.txt"), "untracked\n");
  });
});
