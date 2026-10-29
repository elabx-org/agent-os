/**
 * E-Git's column Pull: fast-forward the branch from its upstream, nothing
 * else. Git refuses (and touches nothing) when that would need a merge or
 * would overwrite local changes; the refusal comes back as the message.
 */

import { execFile } from "child_process";

export type PullResult =
  | { ok: true; output: string }
  | { ok: false; reason: "no-upstream" | "refused"; message: string };

function run(
  cwd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  delete env.GIT_INDEX_FILE;
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number"
            ? error.code
            : error
              ? null
              : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

/** The line a person wants to read from git's output: its summary, else its last */
export function pullSummary(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const summary = [...lines]
    .reverse()
    .find((l) => /files? changed|up to date|Fast-forward/i.test(l));
  return summary || lines[lines.length - 1] || "";
}

/** Why git refused, without its hints */
export function refusalMessage(stderr: string, stdout = ""): string {
  const lines = `${stderr}\n${stdout}`
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^hint:/i.test(l));
  const fatal = lines.find((l) => /^(fatal|error):/i.test(l));
  return (fatal || lines[0] || "git pull failed").replace(
    /^(fatal|error):\s*/i,
    ""
  );
}

export async function pullFastForward(
  cwd: string,
  timeoutMs = 60_000
): Promise<PullResult> {
  const upstream = await run(
    cwd,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    5_000
  );
  if (upstream.code !== 0) {
    return {
      ok: false,
      reason: "no-upstream",
      message: "This branch has no upstream to pull from",
    };
  }
  const pull = await run(
    cwd,
    ["pull", "--ff-only", "--no-rebase", "--no-edit"],
    timeoutMs
  );
  if (pull.code !== 0) {
    return {
      ok: false,
      reason: "refused",
      message:
        pull.code === null
          ? "git pull timed out"
          : refusalMessage(pull.stderr, pull.stdout),
    };
  }
  return { ok: true, output: pullSummary(`${pull.stdout}\n${pull.stderr}`) };
}
