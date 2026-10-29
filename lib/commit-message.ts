/**
 * A commit message for what's changed in a folder, written by Claude
 * (D-Git's "Write with Claude"); mirrors lib/pr-generation.ts. The staged
 * changes when there are any, else everything (untracked files by name).
 */

import { spawn } from "child_process";
import { git } from "@/lib/turns-git";

/** What the prompt shows Claude: enough to describe, small enough to be quick */
const DIFF_CAP = 12_000;
const FILES_CAP = 60;
const SUBJECT_MAX = 72;
const CLI_TIMEOUT_MS = 60_000;

export class NothingToDescribeError extends Error {
  constructor() {
    super("There are no changes to describe");
  }
}

export interface CommitContext {
  /** Only what's staged (that is what the commit will hold) */
  staged: boolean;
  /** `git diff --stat` */
  stat: string;
  /** The diff, cut at DIFF_CAP */
  diff: string;
  /** New files git doesn't track yet (unstaged case only) */
  untracked: string[];
}

/** Runs the CLI with the prompt; resolves its stdout */
export type ClaudeRunner = (cwd: string, prompt: string) => Promise<string>;

const read = (cwd: string, args: string[]) =>
  git(args, { cwd, timeoutMs: 15_000 });

/** The changes to describe, or null when there are none */
export async function collectCommitContext(
  cwd: string
): Promise<CommitContext | null> {
  const diffArgs = ["diff", "--no-color", "--no-ext-diff"];
  const stagedStat = (
    await read(cwd, [...diffArgs, "--cached", "--stat"])
  ).trim();
  if (stagedStat) {
    const diff = await read(cwd, [...diffArgs, "--cached"]);
    return { staged: true, stat: stagedStat, diff: cap(diff), untracked: [] };
  }

  const stat = (await read(cwd, [...diffArgs, "--stat"])).trim();
  const untracked = (
    await read(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])
  )
    .split("\0")
    .filter(Boolean);
  if (!stat && untracked.length === 0) return null;
  const diff = stat ? await read(cwd, diffArgs) : "";
  return { staged: false, stat, diff: cap(diff), untracked };
}

function cap(diff: string): string {
  return diff.length > DIFF_CAP
    ? `${diff.slice(0, DIFF_CAP)}\n... (diff cut short)`
    : diff;
}

export function buildCommitPrompt(context: CommitContext): string {
  const parts = [
    "Write a git commit message for these changes.",
    "",
    "Rules:",
    `- First line: a summary of at most ${SUBJECT_MAX} characters, in the imperative mood ("Add", "Fix", "Move"), with no trailing period and no type prefix.`,
    "- If the change needs explaining, add a blank line and a short body (wrapped at 72 characters) that says why, not how.",
    "- Respond with the commit message only: no quotes, no code fences, no preamble.",
    "",
  ];
  if (context.stat) parts.push("Files changed:", context.stat, "");
  if (context.untracked.length > 0) {
    const shown = context.untracked.slice(0, FILES_CAP);
    parts.push("New files:", ...shown.map((f) => `- ${f}`));
    if (context.untracked.length > shown.length)
      parts.push(`- ... and ${context.untracked.length - shown.length} more`);
    parts.push("");
  }
  if (context.diff) parts.push("Diff:", context.diff);
  return parts.join("\n").trim();
}

/** Claude's reply as a commit message: subject (<= 72, no period), blank line, body */
export function cleanCommitMessage(output: string): string {
  let text = output.replace(/\r\n/g, "\n").trim();
  // A fenced reply: what's inside the fence
  const fence = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const lines = text.split("\n");
  // A preamble line ("Here's a commit message:") or a label
  while (
    lines.length > 1 &&
    /^(here('|’)?s|here is|sure|commit message)\b.*:\s*$/i.test(lines[0].trim())
  )
    lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length === 0) return "";

  let subject = lines[0]
    .trim()
    .replace(/^(commit message|subject)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.。]+$/, "")
    .trim();
  if (subject.length > SUBJECT_MAX) {
    const cut = subject.slice(0, SUBJECT_MAX + 1);
    const space = cut.lastIndexOf(" ");
    subject = (space > 40 ? cut.slice(0, space) : cut.slice(0, SUBJECT_MAX))
      .replace(/[\s,;:.-]+$/, "")
      .trim();
  }

  const body = lines
    .slice(1)
    .join("\n")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return body ? `${subject}\n\n${body}` : subject;
}

/** `claude --print`, the prompt on stdin (a diff can outgrow an argument) */
export const runClaudePrint: ClaudeRunner = (cwd, prompt) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", ["--print"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude took too long to write the message"));
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Claude CLI unavailable: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            stderr.trim().split("\n").pop() || `Claude CLI exited with ${code}`
          )
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });

/** Throws NothingToDescribeError, or an Error when the CLI fails */
export async function generateCommitMessage(
  cwd: string,
  runClaude: ClaudeRunner = runClaudePrint
): Promise<string> {
  const context = await collectCommitContext(cwd);
  if (!context) throw new NothingToDescribeError();
  const message = cleanCommitMessage(
    await runClaude(cwd, buildCommitPrompt(context))
  );
  if (!message) throw new Error("Claude returned an empty message");
  return message;
}
