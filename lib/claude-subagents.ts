/**
 * The subagents a Claude Code session has started (the Agent tool, and the
 * agents a workflow runs). Claude Code keeps each one's conversation beside
 * the session's transcript: <id>/subagents/agent-<agentId>.jsonl, with
 * agent-<agentId>.meta.json saying what it is and whether it finished.
 */

import fs from "fs";
import path from "path";

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

function subagentsDir(transcriptFile: string): string {
  return path.join(transcriptFile.replace(/\.jsonl$/, ""), "subagents");
}

const AGENT_ID = /^[\w-]+$/;

export function subagentFile(
  transcriptFile: string,
  agentId: string
): string | null {
  if (!AGENT_ID.test(agentId)) return null;
  const file = path.join(
    subagentsDir(transcriptFile),
    `agent-${agentId}.jsonl`
  );
  return fs.existsSync(file) ? file : null;
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
    let steps: number | null = null;
    if (stat.size <= COUNT_LIMIT) {
      const text = fs.readFileSync(file, "utf8");
      steps = text.split('"type":"tool_use"').length - 1;
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
