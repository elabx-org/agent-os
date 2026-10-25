/**
 * Claude Code's background agents: sessions started with `claude --bg`,
 * which run without a terminal and are managed with `claude agents`,
 * `logs`, `attach`, `stop` and `rm`. Agent-OS drives the CLI rather than
 * reading its state files, so it sees the same list `claude agents` does.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { readTranscript, type ChatItem } from "@/lib/claude-transcript";

const execFileAsync = promisify(execFile);

export interface BackgroundAgent {
  /** The short id `claude attach`, `logs`, `stop` and `rm` take */
  id: string;
  name: string;
  cwd: string;
  /** As the CLI says it: working, blocked (waiting on you), done, … */
  state: string;
  sessionId: string;
  startedAt: number;
}

// Never a leading "-": it would reach the CLI as a flag
const AGENT_ID = /^\w[\w-]*$/;

export function isAgentId(id: string): boolean {
  return AGENT_ID.test(id);
}

function claudePath(): string {
  const home = process.env.HOME || os.homedir();
  for (const p of [
    path.join(home, ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return "claude";
}

async function claude(args: string[], cwd?: string) {
  return execFileAsync(claudePath(), args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

export async function listBackgroundAgents(): Promise<BackgroundAgent[]> {
  const { stdout } = await claude(["agents", "--json", "--all"]);
  const all = JSON.parse(stdout) as Record<string, unknown>[];
  return all
    .filter((a) => a.kind === "background" && typeof a.id === "string")
    .map((a) => ({
      id: a.id as string,
      name: typeof a.name === "string" ? a.name : (a.id as string),
      cwd: typeof a.cwd === "string" ? a.cwd : "",
      state: typeof a.state === "string" ? a.state : "unknown",
      sessionId: typeof a.sessionId === "string" ? a.sessionId : "",
      startedAt: typeof a.startedAt === "number" ? a.startedAt : 0,
    }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Starts `claude --bg` in `cwd` with the prompt; returns what it printed */
export async function startBackgroundAgent(opts: {
  cwd: string;
  prompt: string;
  model?: string;
}): Promise<string> {
  const args = ["--bg"];
  if (opts.model) args.push("--model", opts.model);
  args.push("--", opts.prompt);
  const { stdout, stderr } = await claude(args, opts.cwd);
  return (stdout + stderr).trim();
}

/** The agent's recent terminal output, cursor moves turned into spacing */
export async function backgroundAgentLogs(id: string): Promise<string> {
  const { stdout } = await claude(["logs", id]);
  return stdout
    .replace(/\x1b\[\d*C/g, " ")
    .replace(/\x1b\[\d*(;\d*)?[BEHf]/g, "\n")
    .replace(/\x1b(\[[\d;?]*[A-Za-z]|\][^\x07]*\x07|.)/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

const MAX_CONVERSATION_ITEMS = 40;

/** The latest of its conversation, or null before it has written one */
export function backgroundAgentConversation(
  agent: BackgroundAgent
): ChatItem[] | null {
  if (!/^[0-9a-f-]{36}$/.test(agent.sessionId)) return null;
  const projects = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "projects"
  );
  const name = `${agent.sessionId}.jsonl`;
  let file = path.join(projects, agent.cwd.replace(/[^a-zA-Z0-9]/g, "-"), name);
  // Agents in a worktree of their own write under that folder instead
  if (!fs.existsSync(file)) {
    const dir = fs
      .readdirSync(projects)
      .find((d) => fs.existsSync(path.join(projects, d, name)));
    if (!dir) return null;
    file = path.join(projects, dir, name);
  }
  const { items } = readTranscript(file, agent.sessionId, agent.cwd);
  return items
    .filter((item) => item.kind !== "result")
    .slice(-MAX_CONVERSATION_ITEMS);
}

/** Stops it, keeping the conversation; `remove` deletes it (`claude rm`) */
export async function stopBackgroundAgent(
  id: string,
  remove: boolean
): Promise<string> {
  const { stdout, stderr } = await claude([remove ? "rm" : "stop", id]);
  return (stdout + stderr).trim();
}
