import { execFile, execSync } from "child_process";
import { promisify } from "util";
import type { PRChecks, PRState, PRSummary } from "@/lib/git-types";

const execFileAsync = promisify(execFile);

export interface PRInfo {
  number: number;
  url: string;
  state: string;
  title: string;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  body: string;
}

// The git page asks on every open: a signed-in gh is remembered for a
// minute, a signed-out one briefly so signing in shows up soon
const GH_OK_TTL_MS = 60_000;
const GH_NO_TTL_MS = 10_000;
let ghAuth: { at: number; ok: boolean } | null = null;
let ghAuthRun: Promise<boolean> | null = null;

function ghAuthCached(): boolean | null {
  if (!ghAuth) return null;
  const ttl = ghAuth.ok ? GH_OK_TTL_MS : GH_NO_TTL_MS;
  return Date.now() - ghAuth.at < ttl ? ghAuth.ok : null;
}

/**
 * Check if gh CLI is installed and authenticated
 */
export function checkGhCli(): boolean {
  const cached = ghAuthCached();
  if (cached !== null) return cached;
  let ok: boolean;
  try {
    execSync("gh auth status", { timeout: 5000, stdio: "pipe" });
    ok = true;
  } catch {
    ok = false;
  }
  ghAuth = { at: Date.now(), ok };
  return ok;
}

/** checkGhCli without blocking the server; concurrent callers share one run */
export function isGhReady(): Promise<boolean> {
  const cached = ghAuthCached();
  if (cached !== null) return Promise.resolve(cached);
  ghAuthRun ??= execFileAsync("gh", ["auth", "status"], { timeout: 5000 })
    .then(
      () => true,
      () => false
    )
    .then((ok) => {
      ghAuth = { at: Date.now(), ok };
      ghAuthRun = null;
      return ok;
    });
  return ghAuthRun;
}

/**
 * Get commits between current branch and base branch
 */
export function getCommitsSinceBase(
  workingDir: string,
  baseBranch = "main"
): CommitInfo[] {
  try {
    // Get the merge base
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();

    // Get commits since merge base
    const output = execSync(
      `git log ${mergeBase}..HEAD --format="COMMIT_START%n%H%n%s%n%b%nCOMMIT_END"`,
      {
        cwd: workingDir,
        encoding: "utf-8",
      }
    );

    const commits: CommitInfo[] = [];
    const parts = output.split("COMMIT_START").filter(Boolean);

    for (const part of parts) {
      const lines = part.split("\n").filter((line) => line !== "COMMIT_END");
      if (lines.length >= 2) {
        const hash = lines[0].trim();
        const subject = lines[1].trim();
        const body = lines.slice(2).join("\n").trim();
        if (hash && subject) {
          commits.push({ hash, subject, body });
        }
      }
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Generate PR title from commits
 */
export function generatePRTitle(
  commits: CommitInfo[],
  branchName: string
): string {
  if (commits.length === 0) {
    // Fallback to branch name
    return branchName
      .replace(/^(feature|fix|hotfix|bugfix|chore|docs)\//i, "")
      .replace(/-/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  if (commits.length === 1) {
    return commits[0].subject;
  }

  // Multiple commits - try to find a common pattern or use the first one
  const firstCommit = commits[0];
  return firstCommit.subject;
}

/**
 * Generate PR body from commits
 */
export function generatePRBody(commits: CommitInfo[]): string {
  if (commits.length === 0) {
    return "## Summary\n\n_No commits yet_\n";
  }

  const lines: string[] = ["## Summary\n"];

  // List all commits
  for (const commit of commits) {
    lines.push(`- ${commit.subject}`);
  }

  lines.push("");
  lines.push("## Changes\n");

  // Add commit bodies if any have meaningful content
  for (const commit of commits) {
    if (commit.body && commit.body.length > 10) {
      lines.push(`### ${commit.subject}\n`);
      lines.push(commit.body);
      lines.push("");
    }
  }

  lines.push("## Test Plan\n");
  lines.push("- [ ] Manual testing completed");
  lines.push("- [ ] Automated tests pass");
  lines.push("");

  return lines.join("\n");
}

// --- The branch's PR with its checks (M2b) ---

/** One entry of gh's statusCheckRollup: a CheckRun or a StatusContext */
export interface CheckRollupEntry {
  __typename?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const RUNNING = new Set([
  "QUEUED",
  "IN_PROGRESS",
  "PENDING",
  "WAITING",
  "REQUESTED",
  "EXPECTED",
]);

/** The rollup as one state: any failure fails, else anything running is pending */
export function foldChecks(
  rollup: CheckRollupEntry[] | null | undefined
): PRChecks {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  const up = (v: string | null | undefined) => (v || "").toUpperCase();
  const failed = rollup.some(
    (c) => FAILED.has(up(c.conclusion)) || FAILED.has(up(c.state))
  );
  if (failed) return "failed";
  // A StatusContext has only a state; a CheckRun a status, then a conclusion
  const pending = rollup.some(
    (c) =>
      RUNNING.has(up(c.state)) ||
      RUNNING.has(up(c.status)) ||
      (!!c.status && up(c.status) !== "COMPLETED")
  );
  return pending ? "pending" : "passed";
}

/** gh pr list's JSON for one PR (the fields PR_FIELDS asks for) */
export interface GhPR {
  number: number;
  url: string;
  state: string;
  title: string;
  isDraft?: boolean;
  statusCheckRollup?: CheckRollupEntry[] | null;
  body?: string | null;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  headRefName?: string;
  baseRefName?: string;
  author?: { login?: string } | null;
  createdAt?: string;
}

export const PR_FIELDS =
  "number,url,state,title,isDraft,statusCheckRollup,body,changedFiles,additions,deletions,headRefName,baseRefName,author,createdAt";

export function toPRSummary(pr: GhPR): PRSummary {
  const state = (pr.state || "").toLowerCase();
  return {
    number: pr.number,
    url: pr.url,
    state: (state === "merged" || state === "closed"
      ? state
      : "open") as PRState,
    title: pr.title || "",
    isDraft: !!pr.isDraft,
    checks: foldChecks(pr.statusCheckRollup),
    body: pr.body || "",
    changedFiles: pr.changedFiles || 0,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    headRefName: pr.headRefName || "",
    baseRefName: pr.baseRefName || "",
    author: pr.author?.login || "",
    createdAt: pr.createdAt || "",
  };
}

/** The branch's PR among gh's list: an open one, else the most recent */
export function pickPR(prs: GhPR[]): GhPR | null {
  if (!Array.isArray(prs) || prs.length === 0) return null;
  const open = prs.find((p) => (p.state || "").toUpperCase() === "OPEN");
  if (open) return open;
  const time = (p: GhPR) => Date.parse(p.createdAt || "") || 0;
  return [...prs].sort((a, b) => time(b) - time(a) || b.number - a.number)[0];
}

/**
 * Get PR for a branch (open, merged or closed); null when there is none or
 * gh can't answer
 */
export async function getPRForBranch(
  workingDir: string,
  branchName: string
): Promise<PRSummary | null> {
  if (!branchName) return null;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branchName,
        "--state",
        "all",
        "--json",
        PR_FIELDS,
        "--limit",
        "5",
      ],
      { cwd: workingDir, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }
    );
    const pr = pickPR(JSON.parse(stdout));
    return pr ? toPRSummary(pr) : null;
  } catch {
    return null;
  }
}

/**
 * Create a new PR
 */
export async function createPR(
  workingDir: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<PRInfo> {
  // First ensure branch is pushed
  try {
    await execFileAsync("git", ["push", "-u", "origin", branchName], {
      cwd: workingDir,
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch {
    // Branch might already be pushed
  }

  // Create PR using gh CLI
  // gh pr create outputs the PR URL on success
  const { stdout: output } = await execFileAsync(
    "gh",
    ["pr", "create", "--title", title, "--base", baseBranch, "--body", body],
    { cwd: workingDir, timeout: 30000 }
  );

  // Parse URL from output (gh pr create prints the URL)
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
  if (!urlMatch) {
    throw new Error("Failed to parse PR URL from output");
  }

  const url = urlMatch[0];
  const number = parseInt(urlMatch[1], 10);

  return {
    number,
    url,
    state: "open",
    title,
  };
}

// --- PR Review functions ---

export interface PRDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: string;
  reviewDecision: string;
  headRefName: string;
  baseRefName: string;
  files: PRFile[];
}

export interface PRFile {
  path: string;
  additions: number;
  deletions: number;
  status: string; // added, modified, removed, renamed
}

export interface PRComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  path?: string;
  line?: number;
  diffHunk?: string;
  isReviewComment: boolean;
}

/**
 * Get detailed PR info including file list
 */
export function getPRDetail(
  workingDir: string,
  prNumber: number
): PRDetail {
  const output = execSync(
    `gh pr view ${prNumber} --json number,title,body,state,author,url,additions,deletions,changedFiles,mergeable,reviewDecision,headRefName,baseRefName,files`,
    {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 15000,
    }
  );
  const data = JSON.parse(output);
  return {
    number: data.number,
    title: data.title,
    body: data.body || "",
    state: data.state,
    author: data.author?.login || data.author?.name || "unknown",
    url: data.url,
    additions: data.additions || 0,
    deletions: data.deletions || 0,
    changedFiles: data.changedFiles || 0,
    mergeable: data.mergeable || "UNKNOWN",
    reviewDecision: data.reviewDecision || "",
    headRefName: data.headRefName || "",
    baseRefName: data.baseRefName || "",
    files: (data.files || []).map(
      (f: { path: string; additions: number; deletions: number; status?: string }) => ({
        path: f.path,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        status: f.status || "modified",
      })
    ),
  };
}

/**
 * Get PR comments (both review comments and issue comments)
 */
export function getPRComments(
  workingDir: string,
  prNumber: number
): PRComment[] {
  const comments: PRComment[] = [];

  // Get review (inline) comments
  try {
    const reviewOutput = execSync(
      `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments --paginate`,
      {
        cwd: workingDir,
        encoding: "utf-8",
        timeout: 15000,
      }
    );
    const reviewComments = JSON.parse(reviewOutput);
    for (const c of reviewComments) {
      comments.push({
        id: c.id,
        author: c.user?.login || "unknown",
        body: c.body || "",
        createdAt: c.created_at,
        path: c.path,
        line: c.line || c.original_line,
        diffHunk: c.diff_hunk,
        isReviewComment: true,
      });
    }
  } catch {
    // Ignore - may not have review comments
  }

  // Get issue-level comments
  try {
    const issueOutput = execSync(
      `gh api repos/{owner}/{repo}/issues/${prNumber}/comments --paginate`,
      {
        cwd: workingDir,
        encoding: "utf-8",
        timeout: 15000,
      }
    );
    const issueComments = JSON.parse(issueOutput);
    for (const c of issueComments) {
      comments.push({
        id: c.id,
        author: c.user?.login || "unknown",
        body: c.body || "",
        createdAt: c.created_at,
        isReviewComment: false,
      });
    }
  } catch {
    // Ignore
  }

  // Sort by date
  comments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return comments;
}

/**
 * Get the full diff for a PR
 */
export function getPRDiff(workingDir: string, prNumber: number): string {
  try {
    return execSync(`gh pr diff ${prNumber}`, {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch {
    return "";
  }
}

/**
 * Submit a PR review (approve, request changes, or comment)
 */
export function submitPRReview(
  workingDir: string,
  prNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string
): void {
  const flag =
    event === "APPROVE"
      ? "--approve"
      : event === "REQUEST_CHANGES"
        ? "--request-changes"
        : "--comment";
  const bodyArg = body ? ` -b '${body.replace(/'/g, "'\\''")}'` : "";
  execSync(`gh pr review ${prNumber} ${flag}${bodyArg}`, {
    cwd: workingDir,
    timeout: 15000,
    stdio: "pipe",
  });
}

/**
 * Merge a PR
 */
export function mergePR(
  workingDir: string,
  prNumber: number,
  method: "merge" | "squash" | "rebase" = "squash"
): void {
  execSync(`gh pr merge ${prNumber} --${method} --delete-branch`, {
    cwd: workingDir,
    timeout: 30000,
    stdio: "pipe",
  });
}

/**
 * Add a comment to a PR
 */
export function addPRComment(
  workingDir: string,
  prNumber: number,
  body: string
): void {
  const bodyEscaped = body.replace(/'/g, "'\\''");
  execSync(`gh pr comment ${prNumber} -b '${bodyEscaped}'`, {
    cwd: workingDir,
    timeout: 15000,
    stdio: "pipe",
  });
}

/**
 * Get current branch name
 */
export function getCurrentBranch(workingDir: string): string {
  return execSync("git branch --show-current", {
    cwd: workingDir,
    encoding: "utf-8",
  }).trim();
}

/**
 * Get the default base branch (main or master)
 */
export function getBaseBranch(workingDir: string): string {
  try {
    // Try to get from remote HEAD
    const output = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo 'refs/heads/main'",
      {
        cwd: workingDir,
        encoding: "utf-8",
      }
    ).trim();
    return output
      .replace("refs/remotes/origin/", "")
      .replace("refs/heads/", "");
  } catch {
    return "main";
  }
}
