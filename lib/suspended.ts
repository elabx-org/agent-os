/**
 * Ctrl+Z in an agent session: Claude Code prints "Run `fg` to bring Claude
 * Code back" and waits for a resume signal. AgentOS starts the agent as the
 * terminal's own process, with no shell under it to run `fg`, so the session
 * would stay stuck. This sends the signal `fg` would have sent and tells the
 * people looking at the terminal what happened.
 */

import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SUSPENDED = /Claude Code has been suspended/;
const SHELLS = new Set(["bash", "sh", "zsh", "fish", "dash", "ksh", "tcsh"]);
/** One try per session in this long */
const RETRY_MS = 10_000;
const NOTICE = "AgentOS: Ctrl+Z paused Claude Code, so AgentOS resumed it";

/** The suspend notice in the last rows of the screen (not old scrollback) */
export function isSuspendedScreen(content: string): boolean {
  const rows = content.split("\n").filter((row) => row.trim());
  return SUSPENDED.test(rows.slice(-12).join("\n"));
}

/** A shell has the terminal: `fg` works there, and a signal would not help */
export function isShell(command: string): boolean {
  return SHELLS.has(command.trim().replace(/^-/, ""));
}

/**
 * The terminal's foreground process group, from /proc/<pid>/stat. The
 * command name (field 2) can hold spaces and brackets, so count after its
 * closing bracket. Null when it can't be read.
 */
export function foregroundGroup(stat: string): number | null {
  const rest = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  // After the name: state, ppid, pgrp, session, tty_nr, tpgid
  const group = Number(rest[5]);
  return Number.isInteger(group) && group > 1 ? group : null;
}

const lastTry = new Map<string, number>();

/**
 * Resumes the agent when `content` (its screen) shows the suspend notice.
 * Returns true when a signal went out.
 */
export async function resumeIfSuspended(
  tmuxName: string,
  content: string
): Promise<boolean> {
  if (!isSuspendedScreen(content)) return false;
  const now = Date.now();
  if (now - (lastTry.get(tmuxName) ?? 0) < RETRY_MS) return false;
  lastTry.set(tmuxName, now);

  try {
    const { stdout } = await execFileAsync("tmux", [
      "display-message",
      "-t",
      tmuxName,
      "-p",
      "#{pane_pid}\t#{pane_current_command}",
    ]);
    const [pidText, command = ""] = stdout.trim().split("\t");
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 1 || isShell(command)) return false;

    let group: number | null = null;
    try {
      group = foregroundGroup(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch {
      // No /proc (macOS): the terminal's own process is the agent
    }
    process.kill(group ? -group : pid, "SIGCONT");
    console.log(`[suspended] resumed ${tmuxName} after Ctrl+Z`);
    notify(tmuxName).catch(() => {});
    return true;
  } catch (error) {
    console.error(`[suspended] ${tmuxName}:`, error);
    return false;
  }
}

/** A line in tmux's message row for everyone attached; types nothing */
async function notify(tmuxName: string): Promise<void> {
  const { stdout } = await execFileAsync("tmux", [
    "list-clients",
    "-t",
    tmuxName,
    "-F",
    "#{client_name}",
  ]);
  for (const client of stdout.split("\n").filter(Boolean)) {
    await execFileAsync("tmux", [
      "display-message",
      "-c",
      client,
      "-d",
      "6000",
      NOTICE,
    ]).catch(() => {});
  }
}
