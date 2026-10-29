import { execFileSync, execSync } from "child_process";
import { unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Expand ~ to home directory in paths
 */
export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace(/^~/, homedir());
  }
  return path;
}

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged";

export interface GitFile {
  path: string;
  status: FileStatus;
  staged: boolean;
  oldPath?: string; // For renamed files
  /** Lines added and removed; absent for untracked and binary files */
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
}

/** Above this many new files a new folder stays one entry */
const UNTRACKED_CAP = 500;

/**
 * Lists each new file instead of its new folder, unless that would be more
 * than UNTRACKED_CAP files (an un-ignored node_modules or build output)
 */
function expandUntrackedFolders(workingDir: string, untracked: GitFile[]) {
  const folders = untracked.filter((f) => f.path.endsWith("/"));
  if (!folders.length) return;
  let files: string[];
  try {
    files = execFileSync(
      "git",
      // Status paths are relative to the repo root, wherever cwd is
      [
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
        "--full-name",
        "--",
        ...folders.map((f) => `:(top)${f.path}`),
      ],
      { cwd: workingDir, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 }
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    // Too many to list (ENOBUFS) or git failed: keep the folders
    return;
  }
  if (files.length > UNTRACKED_CAP) return;
  const kept = untracked.filter((f) => !f.path.endsWith("/"));
  untracked.length = 0;
  untracked.push(...kept);
  for (const path of files) untracked.push({ path, status: "untracked", staged: false });
}

/**
 * Parse git status --porcelain=v2 output
 */
export function getGitStatus(workingDir: string): GitStatus {
  try {
    // Get branch info
    const branchOutput = execSync("git branch --show-current", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const trackingOutput = execSync(
        "git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo '0 0'",
        { cwd: workingDir, encoding: "utf-8" }
      ).trim();
      const [b, a] = trackingOutput.split(/\s+/).map(Number);
      ahead = a || 0;
      behind = b || 0;
    } catch {
      // No upstream configured
    }

    // Get status
    const statusOutput = execSync("git status --porcelain=v1", {
      cwd: workingDir,
      encoding: "utf-8",
    });

    const staged: GitFile[] = [];
    const unstaged: GitFile[] = [];
    const untracked: GitFile[] = [];

    for (const line of statusOutput.split("\n")) {
      if (!line) continue;

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3);

      // Handle renames (format: "R  old -> new")
      let path = filePath;
      let oldPath: string | undefined;
      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        oldPath = parts[0];
        path = parts[1];
      }

      // Untracked files
      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.push({ path, status: "untracked", staged: false });
        continue;
      }

      // Staged changes (index status)
      if (indexStatus !== " " && indexStatus !== "?") {
        staged.push({
          path,
          oldPath,
          status: parseStatus(indexStatus),
          staged: true,
        });
      }

      // Unstaged changes (work tree status)
      if (workTreeStatus !== " " && workTreeStatus !== "?") {
        unstaged.push({
          path,
          oldPath,
          status: parseStatus(workTreeStatus),
          staged: false,
        });
      }
    }

    expandUntrackedFolders(workingDir, untracked);
    addLineCounts(workingDir, staged, "--cached");
    addLineCounts(workingDir, unstaged, "");

    return {
      branch: branchOutput || "HEAD",
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
    };
  } catch (error) {
    throw new Error(
      `Failed to get git status: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function addLineCounts(workingDir: string, files: GitFile[], flag: string) {
  if (!files.length) return;
  try {
    const output = execSync(`git diff ${flag} --numstat --no-renames`, {
      cwd: workingDir,
      encoding: "utf-8",
    });
    const counts = new Map<string, [number, number]>();
    for (const line of output.split("\n")) {
      const [added, removed, path] = line.split("\t");
      // Binary files show "-" for both
      if (path && added !== "-") counts.set(path, [+added, +removed]);
    }
    for (const file of files) {
      const count = counts.get(file.path);
      if (count) [file.additions, file.deletions] = count;
    }
  } catch {
    // Counts are a nicety; the status stands without them
  }
}

function parseStatus(char: string): FileStatus {
  switch (char) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    default:
      return "modified";
  }
}

/**
 * Get diff for a specific file
 */
export function getFileDiff(
  workingDir: string,
  filePath: string,
  staged: boolean
): string {
  try {
    const stagedFlag = staged ? "--staged" : "";
    const output = execSync(
      `git diff ${stagedFlag} -- "${filePath}" 2>/dev/null || true`,
      {
        cwd: workingDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }
    );
    return output;
  } catch {
    return "";
  }
}

/**
 * Get diff for untracked file (show full content)
 */
export function getUntrackedFileDiff(
  workingDir: string,
  filePath: string
): string {
  try {
    const output = execSync(
      `git diff --no-index /dev/null "${filePath}" 2>/dev/null || true`,
      {
        cwd: workingDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    return output;
  } catch {
    return "";
  }
}

/**
 * Stage a file
 */
export function stageFile(workingDir: string, filePath: string): void {
  execSync(`git add -- "${filePath}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Stage all files
 */
export function stageAll(workingDir: string): void {
  execSync("git add -A", {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Unstage a file
 */
export function unstageFile(workingDir: string, filePath: string): void {
  execSync(`git reset HEAD -- "${filePath}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Unstage all files
 */
export function unstageAll(workingDir: string): void {
  execSync("git reset HEAD", {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Discard changes to a file (checkout for tracked, delete for untracked)
 */
export function discardChanges(workingDir: string, filePath: string): void {
  // Check if file is tracked by git
  let tracked = true;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", filePath], {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    tracked = false;
  }
  if (tracked) {
    // A failed checkout (index.lock held by the agent's git) is an error,
    // never a reason to delete a tracked file
    execFileSync("git", ["checkout", "--", filePath], {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } else {
    // File is untracked - delete it
    unlinkSync(join(workingDir, filePath));
  }
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(workingDir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root of the git repository
 */
export function getGitRoot(workingDir: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return workingDir;
  }
}

/**
 * Check if on main/master branch
 */
export function isMainBranch(workingDir: string): boolean {
  try {
    const branch = execSync("git branch --show-current", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();
    return branch === "main" || branch === "master";
  } catch {
    return false;
  }
}

/**
 * Create a new branch and switch to it
 */
export function createBranch(workingDir: string, branchName: string): void {
  execSync(`git checkout -b "${branchName}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Commit staged changes
 */
export function commit(workingDir: string, message: string): string {
  const output = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
  return output;
}

/**
 * Push to remote
 */
export function push(workingDir: string, setUpstream = false): string {
  const branch = execSync("git branch --show-current", {
    cwd: workingDir,
    encoding: "utf-8",
  }).trim();

  const upstreamFlag = setUpstream ? `-u origin "${branch}"` : "";
  const output = execSync(`git push ${upstreamFlag}`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
  return output;
}

/**
 * Check if branch has upstream
 */
export function hasUpstream(workingDir: string): boolean {
  try {
    execSync("git rev-parse --abbrev-ref @{upstream}", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get remote URL
 */
export function getRemoteUrl(workingDir: string): string | null {
  try {
    return execSync("git remote get-url origin", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the default branch name (main or master)
 */
export function getDefaultBranch(workingDir: string): string {
  try {
    // Try to get from remote
    const output = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo 'refs/heads/main'",
      { cwd: workingDir, encoding: "utf-8" }
    ).trim();
    return output
      .replace("refs/remotes/origin/", "")
      .replace("refs/heads/", "");
  } catch {
    return "main";
  }
}

/**
 * Get list of local branches and current branch
 */
export function getBranchList(workingDir: string): {
  branches: string[];
  current: string;
} {
  const current = execSync("git branch --show-current", {
    cwd: workingDir,
    encoding: "utf-8",
  }).trim();

  const output = execSync("git branch --format='%(refname:short)'", {
    cwd: workingDir,
    encoding: "utf-8",
  });

  const branches = output
    .trim()
    .split("\n")
    .filter((b) => b);

  return { branches, current: current || "HEAD" };
}

/**
 * Switch to an existing branch
 */
export function checkoutBranch(workingDir: string, branch: string): void {
  execSync(`git checkout "${branch}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Fetch from remote, pull changes, then push local commits
 */
export function syncBranch(workingDir: string): {
  fetched: boolean;
  pulled: boolean;
  pushed: boolean;
} {
  // Fetch
  execSync("git fetch origin", {
    cwd: workingDir,
    encoding: "utf-8",
    timeout: 30000,
  });

  // Pull (only if upstream is configured)
  let pulled = false;
  if (hasUpstream(workingDir)) {
    execSync("git pull", {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 30000,
    });
    pulled = true;
  }

  // Push (set upstream if needed)
  let pushed = false;
  const needsUpstream = !hasUpstream(workingDir);
  const branch = execSync("git branch --show-current", {
    cwd: workingDir,
    encoding: "utf-8",
  }).trim();

  if (branch) {
    const upstreamFlag = needsUpstream ? `-u origin "${branch}"` : "";
    execSync(`git push ${upstreamFlag}`, {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 30000,
    });
    pushed = true;
  }

  return { fetched: true, pulled, pushed };
}

/**
 * Fetch from remote (read-only — only updates remote tracking branches)
 */
export function fetchRemote(workingDir: string): void {
  execSync("git fetch origin --quiet", {
    cwd: workingDir,
    encoding: "utf-8",
    timeout: 30000,
  });
}

// --- Stash Management ---

export interface StashEntry {
  index: number;
  message: string;
  date: string;
  branch: string;
}

/**
 * Get list of stashes
 */
export function getStashList(workingDir: string): StashEntry[] {
  try {
    const output = execSync(
      'git stash list --format="%gd|||%gs|||%ci"',
      { cwd: workingDir, encoding: "utf-8" }
    );
    if (!output.trim()) return [];

    return output
      .trim()
      .split("\n")
      .map((line) => {
        const [ref, message, date] = line.split("|||");
        const indexMatch = ref?.match(/stash@\{(\d+)\}/);
        const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;
        // Extract branch from message like "WIP on main: abc1234 commit msg"
        const branchMatch = message?.match(/^(?:WIP on|On) ([^:]+)/);
        return {
          index,
          message: message?.replace(/^(?:WIP on|On) [^:]+:\s*/, "").trim() || "Stash",
          date: date?.trim() || "",
          branch: branchMatch?.[1] || "",
        };
      });
  } catch {
    return [];
  }
}

/**
 * Save current changes to stash
 */
export function stashSave(
  workingDir: string,
  message?: string,
  includeUntracked?: boolean
): void {
  const parts = ["git", "stash", "push"];
  if (message) {
    parts.push("-m", `"${message.replace(/"/g, '\\"')}"`);
  }
  if (includeUntracked) {
    parts.push("-u");
  }
  execSync(parts.join(" "), {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Apply a stash (keeps it in the stash list)
 */
export function stashApply(workingDir: string, index: number): string {
  return execSync(`git stash apply stash@{${index}}`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Pop a stash (applies and removes from stash list)
 */
export function stashPop(workingDir: string, index: number): string {
  return execSync(`git stash pop stash@{${index}}`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Drop a stash
 */
export function stashDrop(workingDir: string, index: number): void {
  execSync(`git stash drop stash@{${index}}`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Show stash diff
 */
export function stashShow(workingDir: string, index: number): string {
  try {
    return execSync(`git stash show -p stash@{${index}}`, {
      cwd: workingDir,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}
