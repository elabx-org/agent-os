/**
 * The branch against its base and its upstream, for the git page's branch
 * card ("2 ahead of main · pushed"). Async git with argv arrays only.
 */

import type { BranchInfo } from "@/lib/git-types";
import { git } from "@/lib/turns-git";

export const NO_BRANCH_INFO: BranchInfo = {
  baseBranch: null,
  aheadOfBase: 0,
  behindBase: 0,
  pushed: false,
};

// Every view of a folder polls status on one 15s timer, and several folders
// can share a repo: one run per folder per few seconds is plenty
const TTL_MS = 5_000;
const cache = new Map<string, { at: number; info: Promise<BranchInfo> }>();

/** Drop the cached answer (after a pull, push or commit changes it) */
export function forgetBranchInfo(cwd?: string): void {
  if (cwd === undefined) cache.clear();
  else cache.delete(cwd);
}

/** Never throws: a folder it can't read gets NO_BRANCH_INFO */
export function getBranchInfo(cwd: string): Promise<BranchInfo> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
  const info = readBranchInfo(cwd).catch(() => NO_BRANCH_INFO);
  cache.set(cwd, { at: Date.now(), info });
  return info;
}

const run = (cwd: string, args: string[]) =>
  git(args, { cwd, timeoutMs: 5_000 }).then((out) => out.trim());

/** Whether a full ref name exists */
const hasRef = (cwd: string, ref: string) =>
  run(cwd, ["rev-parse", "--verify", "--quiet", ref]).then(
    () => true,
    () => false
  );

/** origin's default branch, else main, else master, else null */
export async function findBaseBranch(cwd: string): Promise<string | null> {
  try {
    const head = await run(cwd, [
      "symbolic-ref",
      "--quiet",
      "refs/remotes/origin/HEAD",
    ]);
    const name = head.replace(/^refs\/remotes\/origin\//, "");
    if (name && name !== head) return name;
  } catch {
    // No origin/HEAD (a local repo, or a clone that never set it)
  }
  for (const name of ["main", "master"]) {
    if (
      (await hasRef(cwd, `refs/heads/${name}`)) ||
      (await hasRef(cwd, `refs/remotes/origin/${name}`))
    )
      return name;
  }
  return null;
}

async function readBranchInfo(cwd: string): Promise<BranchInfo> {
  const baseBranch = await findBaseBranch(cwd);
  if (!baseBranch) return { ...NO_BRANCH_INFO, pushed: await isPushed(cwd) };

  // origin's copy when there is one: on the base branch itself that is
  // "behind origin/main", elsewhere it is what a PR would go into
  const baseRef = (await hasRef(cwd, `refs/remotes/origin/${baseBranch}`))
    ? `refs/remotes/origin/${baseBranch}`
    : `refs/heads/${baseBranch}`;

  let aheadOfBase = 0;
  let behindBase = 0;
  try {
    const counts = await run(cwd, [
      "rev-list",
      "--left-right",
      "--count",
      `${baseRef}...HEAD`,
    ]);
    const [behind, ahead] = counts.split(/\s+/).map((n) => parseInt(n, 10));
    behindBase = behind || 0;
    aheadOfBase = ahead || 0;
  } catch {
    // An unborn HEAD or a base that's gone: nothing to count
  }

  return { baseBranch, aheadOfBase, behindBase, pushed: await isPushed(cwd) };
}

/** Has an upstream and every commit on HEAD is on it */
async function isPushed(cwd: string): Promise<boolean> {
  try {
    const missing = await run(cwd, [
      "rev-list",
      "--count",
      "@{upstream}..HEAD",
    ]);
    return parseInt(missing, 10) === 0;
  } catch {
    return false;
  }
}
