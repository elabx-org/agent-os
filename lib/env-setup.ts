/**
 * Environment Setup for Worktrees
 *
 * Handles copying env files, installing dependencies, and running setup scripts
 * when creating new worktrees.
 */

import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import {
  everApproved,
  isConfigTrusted,
  projectIdForPath,
  readProjectConfig,
  seedInitialTrust,
} from "./project-config";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface WorktreeConfig {
  setup?: string[];
  devServer?: {
    command: string;
    portEnvVar?: string;
  };
}

export interface SetupResult {
  success: boolean;
  steps: Array<{
    name: string;
    command: string;
    success: boolean;
    output?: string;
    error?: string;
  }>;
  envFilesCopied: string[];
  packageManager?: string;
  port?: number;
}

/**
 * Read worktree config from project: setup/devServer as lib/project-config
 * reads them (`.agent-os/worktrees.json` wins over `.agent-os.json`)
 */
export async function readWorktreeConfig(
  projectPath: string
): Promise<WorktreeConfig | null> {
  const read = await readProjectConfig(projectPath);
  if (!read.exists && !read.legacy) return null;
  const { setup, devServer } = read.effective;
  return { setup, devServer };
}

/**
 * Detect package manager from lockfiles
 */
export function detectPackageManager(projectPath: string): {
  name: string;
  installCommand: string;
} | null {
  const lockfiles = [
    { file: "bun.lockb", name: "bun", command: "bun install" },
    { file: "pnpm-lock.yaml", name: "pnpm", command: "pnpm install" },
    { file: "yarn.lock", name: "yarn", command: "yarn install" },
    { file: "package-lock.json", name: "npm", command: "npm install" },
  ];

  for (const { file, name, command } of lockfiles) {
    if (fs.existsSync(path.join(projectPath, file))) {
      return { name, installCommand: command };
    }
  }

  // Fallback: check if package.json exists
  if (fs.existsSync(path.join(projectPath, "package.json"))) {
    return { name: "npm", installCommand: "npm install" };
  }

  return null;
}

/**
 * Find env files to copy (excludes .env.example)
 */
export function findEnvFiles(projectPath: string): string[] {
  try {
    const files = fs.readdirSync(projectPath);
    return files.filter(
      (f) =>
        f.startsWith(".env") &&
        !f.endsWith(".example") &&
        fs.statSync(path.join(projectPath, f)).isFile()
    );
  } catch {
    return [];
  }
}

/**
 * Copy env files from source to worktree
 */
export async function copyEnvFiles(
  sourcePath: string,
  worktreePath: string
): Promise<string[]> {
  const envFiles = findEnvFiles(sourcePath);
  const copied: string[] = [];

  for (const file of envFiles) {
    try {
      const src = path.join(sourcePath, file);
      const dest = path.join(worktreePath, file);
      await fs.promises.copyFile(src, dest);
      copied.push(file);
    } catch (error) {
      console.error(`Failed to copy ${file}:`, error);
    }
  }

  return copied;
}

/**
 * Run a setup command in the worktree directory
 */
async function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 300000, // 5 minutes
      env: { ...process.env, ...env },
    });
    return {
      success: true,
      output: stdout + (stderr ? `\n${stderr}` : ""),
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: err.stdout || "",
      error: err.stderr || err.message || "Unknown error",
    };
  }
}

/** The step a worktree gets when its config's commands wait for the user */
export const WAITING_STEP = "Setup steps wait for approval";

/**
 * Run setup for a new worktree. The config's setup steps and onWorktree
 * scripts come from a repo file, so they run only once the user approved
 * its hash (lib/project-config.ts); until then nothing from it runs, not
 * even the package-manager install.
 */
export async function setupWorktree(options: {
  worktreePath: string;
  sourcePath: string;
  port?: number;
  skipInstall?: boolean;
  /** The project the source folder belongs to; looked up by path if missing */
  projectId?: string;
}): Promise<SetupResult> {
  const { worktreePath, sourcePath, port, skipInstall } = options;

  const result: SetupResult = {
    success: true,
    steps: [],
    envFilesCopied: [],
    port,
  };

  // 1. Read config if exists
  const read = await readProjectConfig(sourcePath);
  const config = read.effective;
  await seedInitialTrust();
  const projectId =
    options.projectId && options.projectId !== "uncategorized"
      ? options.projectId
      : projectIdForPath(sourcePath);
  const trusted = isConfigTrusted(projectId ?? `path:${sourcePath}`, read);

  // 2. Copy env files
  result.envFilesCopied = await copyEnvFiles(sourcePath, worktreePath);
  if (result.envFilesCopied.length > 0) {
    result.steps.push({
      name: "Copy env files",
      command: `cp ${result.envFilesCopied.join(" ")}`,
      success: true,
      output: `Copied: ${result.envFilesCopied.join(", ")}`,
    });
  }

  if (!trusted) {
    result.success = false;
    result.steps.push({
      name: WAITING_STEP,
      command: "",
      success: false,
      error: `${read.exists ? read.path : read.legacy?.path} ${
        projectId && everApproved(projectId)
          ? "changed since it was approved"
          : "isn't approved yet"
      }`,
    });
    console.log(
      `[env-setup] ${worktreePath}: setup skipped, config not approved (${read.hash.slice(0, 12)})`
    );
    return result;
  }

  // Build env vars for commands
  const envVars: Record<string, string> = {
    ROOT_WORKTREE_PATH: sourcePath,
    WORKTREE_PATH: worktreePath,
  };
  if (port) {
    envVars.PORT = String(port);
  }

  // 3. Run config setup commands if present
  if (config?.setup && config.setup.length > 0) {
    for (const cmd of config.setup) {
      // Expand variables in command
      let expandedCmd = cmd;
      for (const [key, value] of Object.entries(envVars)) {
        expandedCmd = expandedCmd.replace(new RegExp(`\\$${key}`, "g"), value);
      }

      const cmdResult = await runCommand(expandedCmd, worktreePath, envVars);
      result.steps.push({
        name: `Config: ${cmd.slice(0, 50)}${cmd.length > 50 ? "..." : ""}`,
        command: expandedCmd,
        success: cmdResult.success,
        output: cmdResult.output,
        error: cmdResult.error,
      });

      if (!cmdResult.success) {
        result.success = false;
      }
    }
  } else if (!skipInstall) {
    // 4. Auto-detect and install dependencies
    const pm = detectPackageManager(sourcePath);
    if (pm) {
      result.packageManager = pm.name;
      const installResult = await runCommand(
        pm.installCommand,
        worktreePath,
        envVars
      );
      result.steps.push({
        name: `Install dependencies (${pm.name})`,
        command: pm.installCommand,
        success: installResult.success,
        output: installResult.output,
        error: installResult.error,
      });

      if (!installResult.success) {
        result.success = false;
      }
    }
  }

  // 5. The scripts marked "Run when a worktree is created"
  for (const script of config.scripts ?? []) {
    if (!script.onWorktree) continue;
    const scriptResult = await runCommand(
      script.command,
      worktreePath,
      envVars
    );
    result.steps.push({
      name: `Script: ${script.name}`,
      command: script.command,
      success: scriptResult.success,
      output: scriptResult.output,
      error: scriptResult.error,
    });
    if (!scriptResult.success) {
      result.success = false;
    }
  }

  return result;
}

/** Every worktree of the repo at `dir`: path and branch (refs/heads/ dropped) */
export async function listWorktrees(
  dir: string
): Promise<Array<{ path: string; branch: string | null }>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dir, "worktree", "list", "--porcelain"],
      { timeout: 10000 }
    );
    const list: Array<{ path: string; branch: string | null }> = [];
    for (const block of stdout.split("\n\n")) {
      const wt = block.match(/^worktree (.+)$/m)?.[1];
      if (!wt) continue;
      const branch = block.match(/^branch (.+)$/m)?.[1] ?? null;
      list.push({
        path: wt,
        branch: branch?.replace(/^refs\/heads\//, "") ?? null,
      });
    }
    return list;
  } catch {
    return [];
  }
}

/**
 * The folder an agent CLI's own --worktree <name> made (Claude Code puts
 * them under <repo>/.claude/worktrees/): matched by folder or branch name,
 * else the one new folder there since `since` (ms)
 */
export function pickNativeWorktree(
  worktrees: Array<{ path: string; branch: string | null; createdMs?: number }>,
  repoPath: string,
  name: string,
  since: number
): string | null {
  const root =
    path.join(path.resolve(repoPath), ".claude", "worktrees") + path.sep;
  const native = worktrees.filter((w) => path.resolve(w.path).startsWith(root));
  const names = new Set([
    name,
    name.replace(/\//g, "+"),
    name.replace(/\//g, "-"),
    name.split("/").pop() ?? name,
  ]);
  const byName = native.find(
    (w) =>
      names.has(path.basename(w.path)) ||
      (w.branch !== null &&
        (w.branch === name ||
          w.branch === `worktree-${name}` ||
          names.has(w.branch.replace(/^worktree-/, ""))))
  );
  if (byName) return byName.path;
  const fresh = native.filter((w) => (w.createdMs ?? 0) >= since);
  return fresh.length === 1 ? fresh[0].path : null;
}

/** A native --worktree session's folder, once the CLI has made it */
export async function findNativeWorktree(
  repoPath: string,
  name: string,
  since: number
): Promise<string | null> {
  const repo = repoPath.replace(/^~/, process.env.HOME || "");
  const worktrees = (await listWorktrees(repo)).map((w) => {
    let createdMs = 0;
    try {
      const st = fs.statSync(w.path);
      createdMs = st.birthtimeMs || st.ctimeMs;
    } catch {
      // Listed but not on disk yet
    }
    return { ...w, createdMs };
  });
  const found = pickNativeWorktree(worktrees, repo, name, since);
  return found && fs.existsSync(found) ? found : null;
}

/**
 * Native --worktree sessions: the CLI makes the folder itself once it
 * starts, so poll for it (2s, up to `timeoutMs`) and then set it up
 */
export async function setupNativeWorktreeWhenReady(options: {
  repoPath: string;
  name: string;
  projectId?: string;
  timeoutMs?: number;
}): Promise<SetupResult | null> {
  const repoPath = options.repoPath.replace(/^~/, process.env.HOME || "");
  const since = Date.now() - 2000;
  const deadline = Date.now() + (options.timeoutMs ?? 90000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const worktrees = (await listWorktrees(repoPath)).map((w) => {
      let createdMs = 0;
      try {
        const st = fs.statSync(w.path);
        createdMs = st.birthtimeMs || st.ctimeMs;
      } catch {
        // Listed but not on disk yet
      }
      return { ...w, createdMs };
    });
    const found = pickNativeWorktree(worktrees, repoPath, options.name, since);
    if (found && fs.existsSync(found)) {
      return setupWorktree({
        worktreePath: found,
        sourcePath: repoPath,
        projectId: options.projectId,
      });
    }
  }
  console.log(
    `[env-setup] no native worktree for ${options.name} in ${repoPath} after ${Math.round((options.timeoutMs ?? 90000) / 1000)}s`
  );
  return null;
}

/**
 * Get dev server command from config or package.json
 */
export async function getDevServerCommand(
  projectPath: string,
  port?: number
): Promise<{ command: string; port: number } | null> {
  // Check config first
  const config = (await readProjectConfig(projectPath)).effective;
  if (config.devServer?.command) {
    const portEnvVar = config.devServer.portEnvVar || "PORT";
    const finalPort = port || 3000;
    return {
      command: `${portEnvVar}=${finalPort} ${config.devServer.command}`,
      port: finalPort,
    };
  }

  // Check package.json for dev script
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));
      if (pkg.scripts?.dev) {
        const finalPort = port || 3000;
        return {
          command: `PORT=${finalPort} npm run dev`,
          port: finalPort,
        };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}
