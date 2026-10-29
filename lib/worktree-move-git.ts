/**
 * The git side of moving a session into a worktree (M5 U1). Server only.
 * argv-only git (lib/turns-git.ts), async, timeouts; never touches HEAD,
 * the user's index, stash or branches of the source checkout.
 *
 * snapshotForMove: a hidden commit of the working tree (untracked
 * included, ignored left out) through a private index, under
 * refs/agent-os/<sessionId>/move-<ms>. materialise: that tree into the new
 * worktree with its own private index (`read-tree` + `checkout-index`),
 * then verify. cleanSource: only the snapshot's paths, by writing HEAD's
 * blobs and unlinking added files, never checkout/stash/reset.
 * restoreSource: puts the snapshot's content back (rollback).
 *
 * Every file write goes through `checkout-index` on a private index read
 * from the tree that holds the wanted content (HEAD's for cleaning, the
 * snapshot's for materialising and restoring), so modes, symlinks and
 * checkout filters come out as git would write them.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { branchForFeature, branchFromTask } from "./branch-name";
import { slugify } from "./git";
import { GitError, git, gitBuffer } from "./turns-git";
import { getWorktreesDir } from "./worktrees";
import type { UncommittedFile } from "./worktree-move-types";

/** The source checkout as the move sees it */
export interface WorkingTreeState {
  /** The repository's top folder */
  toplevel: string;
  /** HEAD's commit sha */
  head: string;
  /** Checked-out branch, null when detached */
  branch: string | null;
  /** Untracked included, ignored left out */
  uncommitted: UncommittedFile[];
  /** Anything staged in the user's index (the move is refused) */
  staged: boolean;
}

/** How a snapshot path differs from HEAD */
export type MoveChange = "modified" | "added" | "deleted";

export interface MoveSnapshotPath {
  path: string;
  change: MoveChange;
  /** File mode in the snapshot tree (e.g. "100644"), null when deleted */
  mode: string | null;
}

export interface MoveSnapshot {
  /** refs/agent-os/<sessionId>/move-<ms> */
  ref: string;
  /** The snapshot commit */
  commit: string;
  /** Its tree */
  tree: string;
  /** HEAD it was taken over */
  head: string;
  /** Repository-relative paths that differ from HEAD */
  paths: MoveSnapshotPath[];
  /**
   * Untracked files the snapshot left out (too large); the move refuses
   * to clean the source when non-empty
   */
  skipped: string[];
}

/** Untracked files larger than this stay out of the snapshot (listed in skipped) */
const MAX_UNTRACKED = 50 * 1024 * 1024;
const SESSION_ID = /^[\w-]+$/;
const SUFFIX_LIMIT = 50;
const SHORT_MS = 10_000;
const LONG_MS = 120_000;
const CHUNK = 200;

const IDENTITY = {
  GIT_AUTHOR_NAME: "AgentOS",
  GIT_AUTHOR_EMAIL: "agent-os@localhost",
  GIT_COMMITTER_NAME: "AgentOS",
  GIT_COMMITTER_EMAIL: "agent-os@localhost",
};

// Settings that would make a private-index command write anything else
const SAFE = [
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.splitIndex=false",
];

interface OwnIndexOptions {
  cwd: string;
  index: string;
  timeoutMs?: number;
  input?: string | Buffer;
  env?: Record<string, string>;
}

/** git on a private index file (lib/turns-git.ts drops GIT_INDEX_FILE) */
function gitOwn(args: string[], options: OwnIndexOptions): Promise<string> {
  const { cwd, index, timeoutMs = SHORT_MS, input, env: extra } = options;
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  env.GIT_INDEX_FILE = index;
  env.GIT_OPTIONAL_LOCKS = "0";
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...SAFE, ...args],
      { cwd, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (!error) resolve(String(stdout));
        else
          reject(
            new GitError(
              `git ${args[0]} failed`,
              typeof error.code === "number" ? error.code : null
            )
          );
      }
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** A fresh private index file under $(git rev-parse --git-path agent-os) */
async function privateIndex(cwd: string, label: string): Promise<string> {
  const rel = (await git(["rev-parse", "--git-path", "agent-os"], { cwd }))
    .trim()
    .split("\n")[0];
  const dir = path.resolve(cwd, rel);
  await fs.promises.mkdir(dir, { recursive: true });
  return path.join(
    dir,
    `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.index`
  );
}

async function dropIndex(index: string): Promise<void> {
  await fs.promises.rm(index, { force: true });
  await fs.promises.rm(`${index}.lock`, { force: true });
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function nulSplit(out: string): string[] {
  const parts = out.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

async function topOf(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], { cwd })).trim();
}

async function headOf(cwd: string): Promise<string> {
  return (
    await git(["rev-parse", "--verify", "HEAD^{commit}"], { cwd })
  ).trim();
}

/** A branch of that name exists */
export async function branchTaken(
  cwd: string,
  branch: string
): Promise<boolean> {
  const out = await git(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd, okCodes: [0, 1] }
  );
  return out.trim() !== "";
}

/** Porcelain v1 -z: `XY path\0` and, for renames and copies, `orig\0` */
function parsePorcelain(out: string): UncommittedFile[] {
  const parts = nulSplit(out);
  const files: UncommittedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    files.push({ path: entry.slice(3), status });
    if (status[0] === "R" || status[0] === "C") i++;
  }
  return files;
}

/** Index differs from HEAD: X set, or an intent-to-add entry */
function isStaged(file: UncommittedFile): boolean {
  const [x, y] = file.status;
  if (x === "?" || x === "!") return false;
  return x !== " " || y === "A";
}

/** Null outside git */
export async function readWorkingTree(
  cwd: string
): Promise<WorkingTreeState | null> {
  let top: string;
  try {
    top = await topOf(cwd);
  } catch {
    return null;
  }
  if (!top) return null;
  const head = (
    await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], {
      cwd: top,
      okCodes: [0, 1],
    })
  ).trim();
  const branch =
    (
      await git(["symbolic-ref", "--quiet", "--short", "HEAD"], {
        cwd: top,
        okCodes: [0, 1],
      })
    ).trim() || null;
  const uncommitted = parsePorcelain(
    await git(
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=dirty",
      ],
      { cwd: top, timeoutMs: LONG_MS }
    )
  );
  return {
    toplevel: top,
    head,
    branch,
    uncommitted,
    staged: uncommitted.some(isStaged),
  };
}

/** A valid name for a new branch (`git check-ref-format --branch`) */
export async function isValidBranchName(
  cwd: string,
  branch: string
): Promise<boolean> {
  if (!branch || branch.startsWith("-") || branch.includes("@{")) return false;
  try {
    const out = await git(["check-ref-format", "--branch", branch], { cwd });
    return out.trim() === branch;
  } catch {
    return false;
  }
}

/**
 * "fix/keyboardbar-haptics" from the session's name (lib/branch-name.ts),
 * with the next free `-2`, `-3`, … when it exists
 */
export async function suggestBranch(
  cwd: string,
  sessionName: string
): Promise<string> {
  let base = branchFromTask(sessionName);
  if (!base) {
    const feature = branchForFeature(sessionName);
    base = feature === "feature/" ? "feature/move" : feature;
  }
  if (!(await isValidBranchName(cwd, base))) base = "feature/move";
  let branch = base;
  for (let n = 2; await branchTaken(cwd, branch); n++) {
    if (n > SUFFIX_LIMIT) throw new Error(`Branch already exists: ${base}`);
    branch = `${base}-${n}`;
  }
  return branch;
}

/**
 * The default folder for a branch: under getWorktreesDir(), named
 * `<repo>-<branch slug>`, the next free `-2`, … when it exists
 */
export function suggestFolder(repoName: string, branch: string): string {
  // The kind prefix (fix/, feat/, …) says nothing about the folder
  const last = branch.split("/").filter(Boolean).pop() ?? "";
  const slug = slugify(last) || slugify(branch) || "move";
  const repo = slugify(repoName) || "repo";
  const base = path.join(getWorktreesDir(), `${repo}-${slug}`);
  let folder = base;
  for (let n = 2; fs.existsSync(folder); n++) {
    if (n > SUFFIX_LIMIT) throw new Error(`Folder already exists: ${base}`);
    folder = `${base}-${n}`;
  }
  return folder;
}

/** Untracked files (not in HEAD's tree) over MAX_UNTRACKED */
async function bigUntracked(top: string, index: string): Promise<string[]> {
  const out = await gitOwn(["ls-files", "-o", "--exclude-standard", "-z"], {
    cwd: top,
    index,
    timeoutMs: LONG_MS,
  });
  const big: string[] = [];
  for (const rel of nulSplit(out)) {
    try {
      const st = await fs.promises.lstat(path.join(top, rel));
      if (st.isFile() && st.size > MAX_UNTRACKED) big.push(rel);
    } catch {
      // Gone since
    }
  }
  return big;
}

/** Seeds a private index with HEAD's tree, reusing the user's stat info */
async function seedFromHead(
  top: string,
  index: string,
  head: string
): Promise<void> {
  const userIndex = path.resolve(
    top,
    (await git(["rev-parse", "--git-path", "index"], { cwd: top })).trim()
  );
  try {
    await fs.promises.copyFile(userIndex, index);
    // One-tree merge: HEAD's entries, the stat info kept where they match
    await gitOwn(["read-tree", "-m", head], {
      cwd: top,
      index,
      timeoutMs: LONG_MS,
    });
    return;
  } catch {
    // No user index, or it has conflicts: start from HEAD alone
  }
  await dropIndex(index);
  await gitOwn(["read-tree", head], { cwd: top, index, timeoutMs: LONG_MS });
}

/** `diff-tree -r -z` from HEAD to the snapshot tree */
async function changedPaths(
  top: string,
  head: string,
  tree: string
): Promise<{ paths: MoveSnapshotPath[]; gitlinks: string[] }> {
  const out = await git(
    ["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", head, tree],
    { cwd: top, timeoutMs: LONG_MS }
  );
  const parts = nulSplit(out);
  const paths: MoveSnapshotPath[] = [];
  const gitlinks: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    // ":<old mode> <new mode> <old sha> <new sha> <status>"
    const [oldMode, newMode, , , status] = parts[i].slice(1).split(" ");
    const file = parts[i + 1];
    if (oldMode === "160000" || newMode === "160000") {
      gitlinks.push(file);
      continue;
    }
    if (status === "A")
      paths.push({ path: file, change: "added", mode: newMode });
    else if (status === "D")
      paths.push({ path: file, change: "deleted", mode: null });
    else paths.push({ path: file, change: "modified", mode: newMode });
  }
  return { paths, gitlinks };
}

/** Snapshot of the working tree for a move */
export async function snapshotForMove(
  cwd: string,
  sessionId: string
): Promise<MoveSnapshot> {
  if (!SESSION_ID.test(sessionId)) throw new Error("Bad session id");
  const top = await topOf(cwd);
  const head = await headOf(top);
  const index = await privateIndex(top, `move-${sessionId}`);
  try {
    await seedFromHead(top, index, head);
    const big = await bigUntracked(top, index);
    if (big.length > 0) {
      const list = `${index}.pathspec`;
      await fs.promises.writeFile(
        list,
        [".", ...big.map((p) => `:(exclude,literal)${p}`)].join("\0") + "\0"
      );
      try {
        await gitOwn(
          ["add", "-A", `--pathspec-from-file=${list}`, "--pathspec-file-nul"],
          { cwd: top, index, timeoutMs: LONG_MS }
        );
      } finally {
        await fs.promises.rm(list, { force: true });
      }
    } else {
      await gitOwn(["add", "-A"], { cwd: top, index, timeoutMs: LONG_MS });
    }
    const tree = (
      await gitOwn(["write-tree"], { cwd: top, index, timeoutMs: LONG_MS })
    ).trim();
    const ms = Date.now();
    const commit = (
      await gitOwn(
        [
          "commit-tree",
          "--no-gpg-sign",
          "-p",
          head,
          "-m",
          `agent-os ${sessionId} move`,
          tree,
        ],
        { cwd: top, index, env: IDENTITY }
      )
    ).trim();
    const ref = `refs/agent-os/${sessionId}/move-${ms}`;
    await git(["update-ref", ref, commit], { cwd: top });
    const { paths, gitlinks } = await changedPaths(top, head, tree);
    return {
      ref,
      commit,
      tree,
      head,
      paths,
      skipped: [...big, ...gitlinks],
    };
  } finally {
    await dropIndex(index);
  }
}

/**
 * Writes `files` into `top`'s work tree from `tree` through a private
 * index; the checkout's own index is left alone
 */
async function writeFromTree(
  top: string,
  tree: string,
  files: string[],
  label: string
): Promise<void> {
  if (files.length === 0) return;
  const index = await privateIndex(top, label);
  try {
    await gitOwn(["read-tree", tree], { cwd: top, index, timeoutMs: LONG_MS });
    await gitOwn(["checkout-index", "-f", "-z", "--stdin"], {
      cwd: top,
      index,
      timeoutMs: LONG_MS,
      input: files.join("\0") + "\0",
    });
  } finally {
    await dropIndex(index);
  }
}

/** Unlinks repository-relative files, then the folders they leave empty */
async function removeFiles(top: string, files: string[]): Promise<void> {
  const dirs = new Set<string>();
  for (const rel of files) {
    const abs = path.join(top, rel);
    try {
      const st = await fs.promises.lstat(abs);
      if (st.isDirectory()) continue;
      await fs.promises.unlink(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    dirs.add(path.dirname(abs));
  }
  // Deepest first, never above the top
  const ordered = [...dirs].sort((a, b) => b.length - a.length);
  for (const start of ordered) {
    let dir = start;
    while (dir.startsWith(top + path.sep)) {
      try {
        await fs.promises.rmdir(dir);
      } catch {
        break; // Not empty (or gone)
      }
      dir = path.dirname(dir);
    }
  }
}

/** Writes the snapshot's tree into the worktree (private index), then verifies */
export async function materialise(
  snapshot: MoveSnapshot,
  sourceCwd: string,
  worktreePath: string
): Promise<void> {
  void sourceCwd; // The objects are shared; nothing is read from the source
  const top = await topOf(worktreePath);
  const head = await headOf(top);
  if (head !== snapshot.head) {
    throw new Error(
      `Worktree is at ${head.slice(0, 7)}, the snapshot at ${snapshot.head.slice(0, 7)}`
    );
  }
  const written = snapshot.paths.filter((p) => p.change !== "deleted");
  const deleted = snapshot.paths.filter((p) => p.change === "deleted");
  // Removals first: a deleted file may have become a folder
  await removeFiles(
    top,
    deleted.map((p) => p.path)
  );
  await writeFromTree(
    top,
    snapshot.tree,
    written.map((p) => p.path),
    "materialise"
  );
  if (!(await verifyMaterialised(snapshot, top))) {
    throw new Error("The worktree does not match the snapshot");
  }
}

/** Mode and blob of each path in a tree */
async function treeEntries(
  top: string,
  tree: string,
  files: string[]
): Promise<Map<string, { mode: string; sha: string }>> {
  const entries = new Map<string, { mode: string; sha: string }>();
  for (const part of chunks(files)) {
    const out = await git(
      ["ls-tree", "-z", "--full-tree", tree, "--", ...part.map(literal)],
      { cwd: top, timeoutMs: LONG_MS }
    );
    for (const line of nulSplit(out)) {
      const tab = line.indexOf("\t");
      const [mode, , sha] = line.slice(0, tab).split(" ");
      entries.set(line.slice(tab + 1), { mode, sha });
    }
  }
  return entries;
}

/** A pathspec that matches only this exact path */
function literal(p: string): string {
  return `:(literal)${p}`;
}

/** The git mode a file on disk would have, null when missing */
async function diskMode(abs: string): Promise<string | null> {
  try {
    const st = await fs.promises.lstat(abs);
    if (st.isSymbolicLink()) return "120000";
    if (!st.isFile()) return "dir";
    return st.mode & 0o111 ? "100755" : "100644";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: a file stands where a folder on its path would be
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** The blob each on-disk file would hash to (clean filters applied) */
async function diskBlob(
  top: string,
  rel: string,
  mode: string
): Promise<string> {
  const abs = path.join(top, rel);
  if (mode === "120000") {
    const target = await fs.promises.readlink(abs, { encoding: "buffer" });
    return (
      await gitBuffer(
        ["hash-object", "-t", "blob", "--no-filters", "--stdin"],
        {
          cwd: top,
          input: target,
        }
      )
    )
      .toString()
      .trim();
  }
  return (
    await git(["hash-object", `--path=${rel}`, "--", abs], { cwd: top })
  ).trim();
}

/**
 * The snapshot paths whose file on disk under `top` is what `treeish` has
 * there: same mode and blob, or absent (a folder may stand there) when
 * `treeish` has no such file
 */
async function pathsMatching(
  top: string,
  treeish: string,
  files: string[]
): Promise<Set<string>> {
  const entries = await treeEntries(top, treeish, files);
  const same = new Set<string>();
  for (const rel of files) {
    const mode = await diskMode(path.join(top, rel));
    const want = entries.get(rel);
    if (!want) {
      if (mode === null || mode === "dir") same.add(rel);
      continue;
    }
    if (mode !== want.mode) continue;
    if ((await diskBlob(top, rel, mode)) === want.sha) same.add(rel);
  }
  return same;
}

/** The checkout's files match the snapshot for every snapshot path */
export async function verifyMaterialised(
  snapshot: MoveSnapshot,
  worktreePath: string
): Promise<boolean> {
  const top = await topOf(worktreePath);
  const files = snapshot.paths.map((p) => p.path);
  return (await pathsMatching(top, snapshot.tree, files)).size === files.length;
}

/**
 * Returns the source's snapshot paths to HEAD (only those paths). A path
 * written since the snapshot is left alone (it holds newer work, in
 * neither the snapshot nor the worktree); those are returned
 */
export async function cleanSource(
  cwd: string,
  snapshot: MoveSnapshot
): Promise<string[]> {
  if (snapshot.skipped.length > 0) {
    throw new Error(
      `Not cleaned: ${snapshot.skipped.length} file(s) were left out of the snapshot`
    );
  }
  const state = await readWorkingTree(cwd);
  if (!state) throw new Error("Not a git repository");
  if (state.head !== snapshot.head)
    throw new Error("HEAD moved since the snapshot");
  if (state.staged)
    throw new Error("Staged changes appeared since the snapshot");
  const top = state.toplevel;
  const same = await pathsMatching(
    top,
    snapshot.tree,
    snapshot.paths.map((p) => p.path)
  );
  const changed = snapshot.paths
    .filter((p) => !same.has(p.path))
    .map((p) => p.path);
  const fromHead = snapshot.paths
    .filter((p) => p.change !== "added" && same.has(p.path))
    .map((p) => p.path);
  const added = snapshot.paths
    .filter((p) => p.change === "added" && same.has(p.path))
    .map((p) => p.path);
  // Removals first: an added file may sit where HEAD has a folder
  await removeFiles(top, added);
  await writeFromTree(top, snapshot.head, fromHead, "clean");
  return changed;
}

/**
 * Puts the snapshot's content back in the source (rollback of
 * cleanSource), only where the file is still what the clean left (HEAD's):
 * anything written since is kept
 */
export async function restoreSource(
  cwd: string,
  snapshot: MoveSnapshot
): Promise<void> {
  const top = await topOf(cwd);
  const cleaned = await pathsMatching(
    top,
    snapshot.head,
    snapshot.paths.map((p) => p.path)
  );
  const mine = snapshot.paths.filter((p) => cleaned.has(p.path));
  await removeFiles(
    top,
    mine.filter((p) => p.change === "deleted").map((p) => p.path)
  );
  await writeFromTree(
    top,
    snapshot.tree,
    mine.filter((p) => p.change !== "deleted").map((p) => p.path),
    "restore"
  );
}

/** Deletes the snapshot ref (after a successful move it is kept a while) */
export async function dropSnapshot(
  cwd: string,
  snapshot: MoveSnapshot
): Promise<void> {
  if (!snapshot.ref.startsWith("refs/agent-os/")) return;
  await git(["update-ref", "-d", snapshot.ref], { cwd });
}
