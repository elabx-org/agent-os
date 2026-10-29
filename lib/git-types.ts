/**
 * Client-safe types of the Changes and Files views (M2b): the branch against
 * its base, the branch's PR with its checks, and the one-letter git badge
 * the git page and the file tree share.
 */

import type { FileStatus, GitStatus } from "@/lib/git-status";

/** M modified, A added, D deleted, ? untracked (E-Files, D-Git) */
export type GitBadge = "M" | "A" | "D" | "?";

/** Where the branch stands against its base and its upstream (E-Git's branch card) */
export interface BranchInfo {
  /** The branch PRs go into (origin's default, else main/master); null outside one */
  baseBranch: string | null;
  /** Commits on HEAD not on the base: "2 ahead of main" */
  aheadOfBase: number;
  behindBase: number;
  /** Has an upstream and nothing on HEAD is missing from it */
  pushed: boolean;
}

/** GET /api/git/status (without `file`) */
export type GitStatusResponse = GitStatus & BranchInfo;

/** gh's statusCheckRollup folded to one state; null when the PR has no checks */
export type PRChecks = "passed" | "failed" | "pending" | null;

/** gh's PR state, lowercased */
export type PRState = "open" | "closed" | "merged";

/** The branch's PR (E-Git, D-Git): GET /api/git/pr's existingPR */
export interface PRSummary {
  number: number;
  url: string;
  state: PRState;
  title: string;
  isDraft: boolean;
  checks: PRChecks;
  body: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  /** The author's login */
  author: string;
  /** ISO time */
  createdAt: string;
}

/** POST /api/git/commit-message {path} */
export interface CommitMessageResponse {
  message: string;
}

/** POST /api/git/pull {path} */
export interface PullResponse {
  /** git's own summary line ("Already up to date.", "Fast-forward ...") */
  output: string;
}

/** The badge for a file in git status */
export function gitBadgeOf(status: FileStatus): GitBadge {
  switch (status) {
    case "added":
    case "copied":
      return "A";
    case "deleted":
      return "D";
    case "untracked":
      return "?";
    default:
      return "M";
  }
}

/** The badge's colour class (styles/modern.css .git-*) */
export function gitBadgeClass(badge: GitBadge): string {
  return badge === "A"
    ? "git-a"
    : badge === "D"
      ? "git-d"
      : badge === "?"
        ? "git-u"
        : "git-m";
}
