/**
 * The subagents a Claude Code session has started (the Agent tool, and the
 * agents a workflow runs). Claude Code keeps each one's conversation beside
 * the session's transcript: <id>/subagents/agent-<agentId>.jsonl, with
 * agent-<agentId>.meta.json saying what it is and whether it finished.
 */

import fs from "fs";
import path from "path";
import type { SubagentDetail } from "./agent-tree-types";
import {
  contextWindowFor,
  logModel,
  logTokens,
  publicTool,
  readAgentLog,
} from "./agent-tree-log";

/** No new lines for this long and not finished: it was stopped */
const STALE_MS = 5 * 60_000;
/** Bigger conversations aren't read just to count their steps */
const COUNT_LIMIT = 8_000_000;

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

/** A written file's path relative to the session's folder, when inside it */
function relativeTo(cwd: string | undefined, file: string): string {
  if (!cwd) return file;
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file;
}

/** The detail of the conversation in `file` (a subagent's or any other) */
export function conversationDetail(
  file: string,
  agentId: string,
  cwd?: string
): SubagentDetail | null {
  const log = readAgentLog(file);
  if (!log) return null;
  return {
    agentId,
    prompt: log.prompt,
    lastTools: log.tools.slice(-4).map(publicTool),
    filesWritten: [...log.files].map(([file, lines]) => ({
      path: relativeTo(cwd, file),
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
export function subagentDetail(
  transcriptFile: string,
  agentId: string,
  cwd?: string
): SubagentDetail | null {
  const file = subagentFile(transcriptFile, agentId);
  return file ? conversationDetail(file, agentId, cwd) : null;
}
