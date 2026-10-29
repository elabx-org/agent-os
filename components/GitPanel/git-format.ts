/**
 * The git page's words and choices (E-Git, D-Git), pure so they are tested
 * without a repo: the branch card's caption, the PR card's lines, what
 * Commit takes and which history rows are the branch's own.
 */

import type { GitFile } from "@/lib/git-status";
import type { BranchInfo, PRChecks, PRSummary } from "@/lib/git-types";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Under the branch name: "2 ahead of main · pushed", "1 behind main",
 * "Not pushed", "Up to date with main". Without a base (a detached HEAD, a
 * repo with no default branch) the upstream's own ahead/behind, else nothing
 */
export function branchCaption(
  branch: string,
  upstream: { ahead: number; behind: number },
  info: BranchInfo
): string {
  const base = info.baseBranch;
  if (!base) {
    const parts = [];
    if (upstream.ahead) parts.push(`${upstream.ahead} to push`);
    if (upstream.behind) parts.push(`${upstream.behind} to pull`);
    return parts.join(" · ");
  }
  const parts = [];
  if (info.aheadOfBase) parts.push(`${info.aheadOfBase} ahead of ${base}`);
  if (info.behindBase) parts.push(`${info.behindBase} behind ${base}`);
  if (info.aheadOfBase) parts.push(info.pushed ? "pushed" : "not pushed");
  if (parts.length) {
    // "2 ahead of main · 1 behind main" reads once: "2 ahead, 1 behind main"
    if (info.aheadOfBase && info.behindBase)
      parts.splice(
        0,
        2,
        `${info.aheadOfBase} ahead, ${info.behindBase} behind ${base}`
      );
    return parts.join(" · ");
  }
  if (branch && branch !== base && !info.pushed) return "Not pushed";
  return `Up to date with ${base}`;
}

/** The checks' words beside their dot */
export function checksLabel(checks: PRChecks): string {
  switch (checks) {
    case "passed":
      return "Checks passed";
    case "failed":
      return "Checks failed";
    case "pending":
      return "Checks running";
    default:
      return "No checks";
  }
}

/** The PR card's tone: its edge and dot (.pr-card.checks-*, .check-dot.*) */
export function checksTone(checks: PRChecks): string {
  return checks ? `checks-${checks}` : "";
}

/** git's %ci ("2026-10-27 10:00:00 +0100") as ISO, which WebKit parses */
const gitDate = (s: string) =>
  s
    .trim()
    .replace(
      /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ?([+-]\d\d)(\d\d)$/,
      "$1T$2$3:$4"
    );

/** "now", "6m", "2h", "2d", "3w", "1y" since a time (ISO, git's %ci, or epoch ms) */
export function shortAge(when: string | number, now = Date.now()): string {
  const t = typeof when === "number" ? when : Date.parse(gitDate(when));
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 365)}y`;
}

const STATE_WORD: Record<PRSummary["state"], string> = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

/** E-Git's PR caption: "Open · 2 files" */
export function prStateCaption(pr: PRSummary): string {
  const state =
    pr.isDraft && pr.state === "open"
      ? "Draft"
      : (STATE_WORD[pr.state] ?? pr.state);
  return `${state} · ${plural(pr.changedFiles, "file")}`;
}

/** D-Git's: "fix/x → main · 2 files · opened by Claude 6m ago" */
export function prMetaCaption(pr: PRSummary, now = Date.now()): string {
  const parts = [
    `${pr.headRefName} → ${pr.baseRefName}`,
    plural(pr.changedFiles, "file"),
  ];
  const age = pr.createdAt ? shortAge(pr.createdAt, now) : "";
  const ago = age === "now" ? "just now" : age ? `${age} ago` : "";
  if (pr.author)
    parts.push(["opened by", pr.author, ago].filter(Boolean).join(" "));
  return parts.join(" · ");
}

/**
 * The PR body's first paragraph as plain text, for D-Git's two lines:
 * headings, comments, checklists and markdown marks left out
 */
export function prBlurb(body: string): string {
  const text = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\r/g, "");
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*]\s*\[[ x]\]/i.test(l));
    if (!lines.length) continue;
    return lines
      .join(" ")
      .replace(/^[-*]\s+/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]+/g, "")
      .trim();
  }
  return "";
}

type AnyFile = GitFile & { repoPath?: string };

/** What Commit commits: one repo's files, staged first if they are not yet */
export interface CommitGroup {
  repoPath: string;
  files: string[];
}

export interface CommitTarget {
  /** Something is staged: only that. Else everything listed, staged first */
  staged: boolean;
  count: number;
  groups: CommitGroup[];
}

/**
 * Commit takes what is staged when anything is, else every changed file
 * (staging them first). Multi-repo files carry their repo; others are in
 * `repoPath`
 */
export function commitTarget(
  status: { staged: AnyFile[]; unstaged: AnyFile[]; untracked: AnyFile[] },
  repoPath: string
): CommitTarget {
  const staged = status.staged.length > 0;
  const files = staged
    ? status.staged
    : [...status.unstaged, ...status.untracked];
  const groups = new Map<string, Set<string>>();
  for (const f of files) {
    const repo = f.repoPath || repoPath;
    if (!groups.has(repo)) groups.set(repo, new Set());
    groups.get(repo)!.add(f.path);
  }
  const list = [...groups].map(([repo, paths]) => ({
    repoPath: repo,
    files: [...paths],
  }));
  return {
    staged,
    count: list.reduce((n, g) => n + g.files.length, 0),
    groups: list,
  };
}

/** "Commit 2 files" (D-Git); "Commit" when there is nothing */
export function commitLabel(count: number): string {
  return count ? `Commit ${plural(count, "file")}` : "Commit";
}

/**
 * History's own commits (a filled node): on This branch, the newest
 * `aheadOfBase` are the branch's; on the base, none
 */
export function isOwnCommit(
  index: number,
  aheadOfBase: number,
  onBranch: boolean
): boolean {
  return onBranch && index < aheadOfBase;
}

/** Is this the base itself (no New pull request there, no This branch/main toggle) */
export function onBaseBranch(branch: string, info: BranchInfo): boolean {
  return !!info.baseBranch && branch === info.baseBranch;
}

/** The changed files in list order: staged, then changed, then new */
export function changedFiles<T extends GitFile>(status: {
  staged: T[];
  unstaged: T[];
  untracked: T[];
}): T[] {
  return [...status.staged, ...status.unstaged, ...status.untracked];
}
