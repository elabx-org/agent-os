/**
 * The branch against its base and its upstream, for the git page's branch
 * card ("2 ahead of main · pushed"). Async git with argv arrays only.
 */

import type { BranchInfo } from "@/lib/git-types";

export const NO_BRANCH_INFO: BranchInfo = {
  baseBranch: null,
  aheadOfBase: 0,
  behindBase: 0,
  pushed: false,
};

/** Never throws: a folder it can't read gets NO_BRANCH_INFO */
export async function getBranchInfo(_cwd: string): Promise<BranchInfo> {
  // M2b contract stub: U2b.1 fills it in
  return NO_BRANCH_INFO;
}
