/**
 * Git for turns and diffs: argv only, async, with a timeout, never through
 * a shell. Exit codes in `okCodes` resolve (git diff --no-index exits 1).
 */

import { execFile } from "child_process";

export interface GitOptions {
  cwd: string;
  timeoutMs?: number;
  okCodes?: number[];
  input?: string | Buffer;
}

const SAFE = ["-c", "gc.auto=0", "-c", "core.fsmonitor=false"];

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null
  ) {
    super(message);
  }
}

export function gitBuffer(
  args: string[],
  options: GitOptions
): Promise<Buffer> {
  const { cwd, timeoutMs = 10_000, okCodes = [0], input } = options;
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  // Reads must not refresh the user's index either
  env.GIT_OPTIONAL_LOCKS = "0";
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...SAFE, ...args],
      {
        cwd,
        env,
        timeout: timeoutMs,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout) => {
        const code =
          error && typeof error.code === "number"
            ? error.code
            : error
              ? null
              : 0;
        if (code !== null && okCodes.includes(code)) resolve(stdout);
        else reject(new GitError(`git ${args[0]} failed`, code));
      }
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

export async function git(
  args: string[],
  options: GitOptions
): Promise<string> {
  return (await gitBuffer(args, options)).toString("utf8");
}

/** The repository's top folder, or null outside git */
export async function toplevel(cwd: string): Promise<string | null> {
  try {
    return (
      (await git(["rev-parse", "--show-toplevel"], { cwd })).trim() || null
    );
  } catch {
    return null;
  }
}
