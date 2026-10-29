/**
 * The subagents a Claude Code session has started (the Agent tool, and the
 * agents a workflow runs). Claude Code keeps each one's conversation beside
 * the session's transcript: <id>/subagents/agent-<agentId>.jsonl, with
 * agent-<agentId>.meta.json saying what it is and whether it finished.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { SubagentDetail } from "./agent-tree-types";
import {
  contextWindowFor,
  firstTask,
  logModel,
  ownTask,
  shortPrompt,
  logTokens,
  publicTool,
  readAgentLog,
} from "./agent-tree-log";

/** No new lines for this long and not finished: it was stopped */
const STALE_MS = 5 * 60_000;
/** Bigger conversations aren't read just to count their steps */
export const COUNT_LIMIT = 8_000_000;
/** A workflow agent's prompt is compared with at most this many others */
const SIBLINGS_READ = 12;

export interface SubagentInfo {
  agentId: string;
  /** The Agent tool call that started it, to match its row in the chat */
  toolUseId: string | null;
  description: string;
  agentType: string;
  status: "running" | "done" | "stopped";
  /** Tool calls so far */
  steps: number | null;
  startedAt: string;
  updatedAt: string;
}

/**
 * Step counts by file, kept while the file is unchanged: the home polls
 * every few seconds and a finished agent's file never changes again
 */
const stepCache = new Map<
  string,
  { mtimeMs: number; size: number; steps: number }
>();

function countSteps(file: string, stat: fs.Stats): number | null {
  const cached = stepCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size)
    return cached.steps;
  if (stat.size > COUNT_LIMIT) return null;
  const text = fs.readFileSync(file, "utf8");
  const steps = text.split('"type":"tool_use"').length - 1;
  stepCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, steps });
  return steps;
}

function subagentsDir(transcriptFile: string): string {
  return path.join(transcriptFile.replace(/\.jsonl$/, ""), "subagents");
}

const AGENT_ID = /^[\w-]+$/;

export function subagentFile(
  transcriptFile: string,
  agentId: string
): string | null {
  if (!AGENT_ID.test(agentId)) return null;
  const dir = subagentsDir(transcriptFile);
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  if (fs.existsSync(file)) return file;
  // A workflow's agents live in workflows/<runId>/
  try {
    for (const run of fs.readdirSync(path.join(dir, "workflows"))) {
      const inRun = path.join(dir, "workflows", run, `agent-${agentId}.jsonl`);
      if (fs.existsSync(inRun)) return inRun;
    }
  } catch {}
  return null;
}

export function listSubagents(transcriptFile: string): SubagentInfo[] {
  const dir = subagentsDir(transcriptFile);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const now = Date.now();
  const out: SubagentInfo[] = [];
  for (const name of names) {
    const m = /^agent-([\w-]+)\.meta\.json$/.exec(name);
    if (!m) continue;
    const agentId = m[1];
    const file = path.join(dir, `agent-${agentId}.jsonl`);
    let meta: Record<string, unknown>;
    let stat: fs.Stats;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    let steps: number | null;
    try {
      steps = countSteps(file, stat);
    } catch {
      steps = null;
    }
    out.push({
      agentId,
      toolUseId: typeof meta.toolUseId === "string" ? meta.toolUseId : null,
      description:
        typeof meta.description === "string" ? meta.description : "Agent",
      agentType: typeof meta.agentType === "string" ? meta.agentType : "",
      status: meta.finished
        ? "done"
        : now - stat.mtimeMs < STALE_MS
          ? "running"
          : "stopped",
      steps,
      startedAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** The folder holding `dir`'s .git, if any */
function repoRoot(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return null;
  }
}

/**
 * A written file's path as the pane shows it: relative to the first of
 * `bases` it is inside (the session's folders), else to the repository
 * around them, else with the home folder as "~"
 */
export function shownPath(bases: string[], file: string): string {
  const roots = [...bases];
  for (const base of bases) {
    const root = repoRoot(base);
    if (root) roots.push(root);
  }
  for (const base of roots) {
    const rel = path.relative(base, file);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  }
  const home = os.homedir();
  return home && home !== "/" && file.startsWith(home + "/")
    ? "~" + file.slice(home.length)
    : file;
}

/** The detail of the conversation in `file` (a subagent's or any other) */
export async function conversationDetail(
  file: string,
  agentId: string,
  cwd?: string | string[]
): Promise<SubagentDetail | null> {
  const bases = (Array.isArray(cwd) ? cwd : [cwd]).filter(
    (b): b is string => !!b
  );
  const log = await readAgentLog(file);
  if (!log) return null;
  // The folder the agent itself ran in counts too (a workflow's agents may
  // write outside the session's)
  if (log.cwd) bases.push(log.cwd);
  let prompt = log.prompt;
  // A workflow's agents (workflows/<runId>/): only what this one was asked
  if (
    prompt &&
    path.basename(path.dirname(path.dirname(file))) === "workflows"
  ) {
    const dir = path.dirname(file);
    let names: string[] = [];
    try {
      names = (await fs.promises.readdir(dir)).filter(
        (n) => /^agent-[\w-]+\.jsonl$/.test(n) && n !== path.basename(file)
      );
    } catch {}
    const siblings = await Promise.all(
      names.slice(0, SIBLINGS_READ).map((n) => firstTask(path.join(dir, n)))
    );
    prompt = ownTask(
      prompt,
      siblings.filter((s): s is string => !!s)
    );
  }
  return {
    agentId,
    prompt: shortPrompt(prompt),
    lastTools: log.tools.slice(-4).map(publicTool),
    filesWritten: [...log.files].map(([file, lines]) => ({
      path: shownPath(bases, file),
      ...lines,
    })),
    usage: log.usage && { ...log.usage },
    model: logModel(log),
    tokens: logTokens(log),
    contextWindow: log.usage ? contextWindowFor(log) : null,
    updatedAt: log.updatedAt,
  };
}

/**
 * What one subagent was asked, its last four tool calls, the files it wrote
 * and its usage (O-Tree's right page, D-Tree's panel), reading only what was
 * added since the last call, like agentUsage. Null if there is no such
 * agent.
 */
export async function subagentDetail(
  transcriptFile: string,
  agentId: string,
  cwd?: string | string[]
): Promise<SubagentDetail | null> {
  const file = subagentFile(transcriptFile, agentId);
  return file ? conversationDetail(file, agentId, cwd) : null;
}
