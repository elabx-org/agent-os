/**
 * Git Worktree management for isolated feature development
 */

import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  isGitRepo,
  branchExists,
  getRepoName,
  slugify,
  generateBranchName,
} from "./git";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Base directory for all worktrees
const WORKTREES_DIR = path.join(os.homedir(), ".agent-os", "worktrees");

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  projectPath: string;
  projectName: string;
}

export interface CreateWorktreeOptions {
  projectPath: string;
  featureName: string;
  baseBranch?: string;
  /**
   * M5 (move a session into a worktree): the exact branch to create (no
   * `-2` suffixing: refused when it exists), the exact folder (refused when
   * it exists), and the commit to start from, e.g. "HEAD" (no origin/
   * lookup). Absent: today's behaviour. Implemented in M5 U1
   */
  branchName?: string;
  worktreePath?: string;
  fromRef?: string;
}

/**
 * Ensure the worktrees directory exists
 */
async function ensureWorktreesDir(): Promise<void> {
  await fs.promises.mkdir(WORKTREES_DIR, { recursive: true });
}

/**
 * Resolve a path, expanding ~ to home directory
 */
function resolvePath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

/**
 * Generate a unique worktree directory name
 */
function generateWorktreeDirName(
  projectName: string,
  featureName: string
): string {
  const featureSlug = slugify(featureName);
  return `${projectName}-${featureSlug}`;
}

/**
 * Create a new worktree for a feature branch
 */
export async function createWorktree(
  options: CreateWorktreeOptions
): Promise<WorktreeInfo> {
  const { projectPath, featureName, baseBranch = "main" } = options;

  const resolvedProjectPath = resolvePath(projectPath);

  // Validate project is a git repo
  if (!(await isGitRepo(resolvedProjectPath))) {
    throw new Error(`Not a git repository: ${projectPath}`);
  }

  const projectName = getRepoName(resolvedProjectPath);
  let branchName: string;
  let suffix = "";
  if (options.branchName !== undefined) {
    // Exactly this branch: never suffixed, refused when it exists
    branchName = options.branchName;
    await checkNewBranch(resolvedProjectPath, branchName);
  } else {
    // Generate branch name. A task's name (`fix/foo`) is used as it is, so it
    // can meet a branch made by hand: then the next free `-2`, `-3`, …
    const baseName = generateBranchName(featureName);
    branchName = baseName;
    for (let n = 2; await branchExists(resolvedProjectPath, branchName); n++) {
      if (n > 20) throw new Error(`Branch already exists: ${baseName}`);
      suffix = `-${n}`;
      branchName = `${baseName}${suffix}`;
    }
  }

  // Generate worktree path
  const worktreePath =
    options.worktreePath !== undefined
      ? path.resolve(resolvePath(options.worktreePath))
      : path.join(
          WORKTREES_DIR,
          generateWorktreeDirName(projectName, featureName) + suffix
        );

  // Check if worktree path already exists
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  // Ensure the folder that holds it exists
  if (options.worktreePath !== undefined) {
    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });
  } else {
    await ensureWorktreesDir();
  }

  if (options.fromRef !== undefined) {
    // Exactly this commit (e.g. HEAD, unpushed commits included): no origin/
    const start = await resolveCommit(resolvedProjectPath, options.fromRef);
    try {
      await worktreeAdd(resolvedProjectPath, branchName, worktreePath, start);
    } catch (error: unknown) {
      throw new Error(`Failed to create worktree: ${errorText(error)}`);
    }
    return {
      worktreePath,
      branchName,
      baseBranch: options.fromRef,
      projectPath: resolvedProjectPath,
      projectName,
    };
  }

  // Create the worktree with a new branch
  // Try multiple ref formats to avoid "ambiguous refname" errors
  const refFormats = [
    `origin/${baseBranch}`, // Try remote first (most explicit)
    `refs/heads/${baseBranch}`, // Then local branch
    baseBranch, // Finally, bare name as fallback
  ];

  let lastError: Error | null = null;
  for (const ref of refFormats) {
    try {
      await worktreeAdd(resolvedProjectPath, branchName, worktreePath, ref);
      lastError = null;
      break; // Success!
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next ref format
    }
  }

  if (lastError) {
    throw new Error(`Failed to create worktree: ${lastError.message}`);
  }

  return {
    worktreePath,
    branchName,
    baseBranch,
    projectPath: resolvedProjectPath,
    projectName,
  };
}

/** argv git in the project, with a timeout */
async function gitIn(
  projectPath: string,
  args: string[],
  timeout = 10000
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", projectPath, ...args], {
    timeout,
  });
  return stdout;
}

function errorText(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

async function worktreeAdd(
  projectPath: string,
  branchName: string,
  worktreePath: string,
  ref: string
): Promise<void> {
  await gitIn(
    projectPath,
    ["worktree", "add", "-b", branchName, "--", worktreePath, ref],
    30000
  );
}

/** A valid branch name that does not exist yet, or throws */
async function checkNewBranch(
  projectPath: string,
  branchName: string
): Promise<void> {
  let valid = false;
  if (branchName && !branchName.startsWith("-")) {
    try {
      const out = await gitIn(projectPath, [
        "check-ref-format",
        "--branch",
        branchName,
      ]);
      valid = out.trim() === branchName;
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new Error(`Invalid branch name: ${branchName}`);
  try {
    await gitIn(projectPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
  } catch {
    return; // Free
  }
  throw new Error(`Branch already exists: ${branchName}`);
}

/** The commit a ref names, or throws */
async function resolveCommit(
  projectPath: string,
  ref: string
): Promise<string> {
  if (!ref || ref.startsWith("-")) throw new Error(`Invalid ref: ${ref}`);
  try {
    return (
      await gitIn(projectPath, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      ])
    ).trim();
  } catch {
    throw new Error(`Unknown ref: ${ref}`);
  }
}

/**
 * Delete a worktree and optionally its branch
 */
export async function deleteWorktree(
  worktreePath: string,
  projectPath: string,
  deleteBranch = false
): Promise<void> {
  const resolvedProjectPath = resolvePath(projectPath);
  const resolvedWorktreePath = resolvePath(worktreePath);

  // Get the branch name before removing (for optional deletion)
  let branchName: string | null = null;
  if (deleteBranch) {
    try {
      branchName = (
        await gitIn(
          resolvedWorktreePath,
          ["rev-parse", "--abbrev-ref", "HEAD"],
          5000
        )
      ).trim();
    } catch {
      // Ignore - worktree might already be gone
    }
  }

  // Remove the worktree
  try {
    await gitIn(
      resolvedProjectPath,
      ["worktree", "remove", "--force", "--", resolvedWorktreePath],
      30000
    );
  } catch {
    // If git worktree remove fails, try manual cleanup
    if (fs.existsSync(resolvedWorktreePath)) {
      await fs.promises.rm(resolvedWorktreePath, {
        recursive: true,
        force: true,
      });
    }
    // Prune worktree references
    try {
      await gitIn(resolvedProjectPath, ["worktree", "prune"]);
    } catch {
      // Ignore prune errors
    }
  }

  // Optionally delete the branch
  if (
    deleteBranch &&
    branchName &&
    branchName !== "HEAD" &&
    branchName !== "main" &&
    branchName !== "master"
  ) {
    try {
      await gitIn(resolvedProjectPath, ["branch", "-D", "--", branchName]);
    } catch {
      // Ignore branch deletion errors (might be merged or checked out elsewhere)
    }
  }
}

/**
 * List all worktrees for a project
 */
export async function listWorktrees(projectPath: string): Promise<
  Array<{
    path: string;
    branch: string;
    head: string;
  }>
> {
  const resolvedProjectPath = resolvePath(projectPath);

  try {
    const { stdout } = await execAsync(
      `git -C "${resolvedProjectPath}" worktree list --porcelain`,
      { timeout: 10000 }
    );

    const worktrees: Array<{ path: string; branch: string; head: string }> = [];
    const entries = stdout.split("\n\n").filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split("\n");
      let worktreePath = "";
      let branch = "";
      let head = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktreePath = line.slice(9);
        } else if (line.startsWith("branch ")) {
          branch = line.slice(7).replace("refs/heads/", "");
        } else if (line.startsWith("HEAD ")) {
          head = line.slice(5);
        }
      }

      if (worktreePath) {
        worktrees.push({ path: worktreePath, branch, head });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Check if a path is inside an AgentOS worktree
 */
export function isAgentOSWorktree(worktreePath: string): boolean {
  const resolvedPath = resolvePath(worktreePath);
  return resolvedPath.startsWith(WORKTREES_DIR);
}

/**
 * Get the worktrees base directory
 */
export function getWorktreesDir(): string {
  return WORKTREES_DIR;
}
