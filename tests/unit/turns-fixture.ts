/**
 * Temp git repos for the snapshot, turn and undo tests (not a test file:
 * test:unit only runs *.test.ts). Everything lives under the OS temp dir;
 * scripts resolve from the repo root, where npm runs the tests.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOOK = path.resolve("scripts/agentos-hook.mjs");
export const SNAPSHOT = path.resolve("scripts/agentos-snapshot.mjs");

const QUIET_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
};
delete QUIET_ENV.GIT_INDEX_FILE;

export function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: QUIET_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agentos-${prefix}-`));
}

/** A repo with two commits' worth of files, a .gitignore and a staged change */
export function makeRepo(root = tmpDir("repo")): string {
  g(root, "init", "-q", "-b", "main");
  g(root, "config", "user.email", "test@example.com");
  g(root, "config", "user.name", "Test");
  g(root, "config", "commit.gpgsign", "false");
  write(root, "a.txt", "alpha\n");
  write(root, "b.txt", "bravo\n");
  write(root, "c.txt", "charlie\n");
  write(root, "src/d.ts", "export const d = 1;\n");
  write(root, "run.sh", "#!/bin/sh\necho hi\n");
  fs.chmodSync(path.join(root, "run.sh"), 0o755);
  write(root, ".gitignore", "ignored/\n*.log\n");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "init");
  g(root, "branch", "side");
  write(root, "c.txt", "charlie staged\n");
  g(root, "add", "c.txt");
  write(root, "c.txt", "charlie staged then edited\n");
  write(root, "ignored/x.txt", "ignored\n");
  write(root, "notes.log", "log\n");
  write(root, "untracked.txt", "untracked\n");
  return root;
}

export function write(root: string, rel: string, text: string | Buffer) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** What a snapshot or an undo must leave exactly as it was */
export function userState(root: string) {
  const gitDir = path.resolve(root, g(root, "rev-parse", "--git-dir").trim());
  const index = createHash("sha256")
    .update(fs.readFileSync(path.join(gitDir, "index")))
    .digest("hex");
  return {
    index,
    head: g(root, "rev-parse", "HEAD").trim(),
    symbolic: g(root, "symbolic-ref", "-q", "HEAD").trim(),
    stash: g(root, "stash", "list"),
    branches: g(root, "for-each-ref", "refs/heads", "refs/tags"),
    status: g(root, "status", "--porcelain", "--untracked-files=all"),
  };
}

export function agentRefs(root: string, sessionId: string): string[] {
  return g(
    root,
    "for-each-ref",
    "--format=%(refname)",
    `refs/agent-os/${sessionId}/`
  )
    .split("\n")
    .filter(Boolean);
}

/** Runs the real hook with a synthetic event, as Claude Code would */
export function runHook(stateDir: string, input: object) {
  return spawnSync(process.execPath, [HOOK, stateDir], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 10_000,
  });
}

export async function waitFor(
  check: () => boolean,
  timeoutMs = 15_000
): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error("Timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function journal(stateDir: string): Record<string, unknown>[] {
  try {
    return fs
      .readFileSync(path.join(stateDir, "turns.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** One Claude turn through the hook: prompt, edits, then Stop (post awaited) */
export async function claudeTurn(
  stateDir: string,
  cwd: string,
  prompt: string,
  edit: (record: (rel: string, tool?: string) => void) => void
) {
  const base = {
    session_id: "claude-uuid",
    cwd,
    transcript_path: "/nonexistent",
  };
  runHook(stateDir, { ...base, hook_event_name: "UserPromptSubmit", prompt });
  edit((rel, tool = "Edit") =>
    runHook(stateDir, {
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: tool,
      tool_use_id: `t-${rel}`,
      tool_input: { file_path: path.join(cwd, rel) },
    })
  );
  const posts = journal(stateDir).filter((e) => e.e === "post").length;
  runHook(stateDir, { ...base, hook_event_name: "Stop" });
  await waitFor(
    () => journal(stateDir).filter((e) => e.e === "post").length > posts
  );
}
