/**
 * The workflows a Claude Code session has run (the Workflow tool: a script
 * that fans work out to many agents). Claude Code keeps each run's agents in
 * <id>/subagents/workflows/<runId>/, with journal.jsonl recording each agent
 * as it starts ("started": label and phase) and finishes ("result"). When a
 * run ends it writes <id>/workflows/<runId>.json with its name and status.
 */

import fs from "fs";
import path from "path";

/** No new lines for this long and no summary: it was stopped */
const STALE_MS = 5 * 60_000;

export interface WorkflowAgent {
  agentId: string;
  label: string;
  phase: string | null;
  status: "running" | "done" | "stopped";
  /** "Opus 5.5", from its conversation */
  model: string | null;
  /** Its context at the latest turn (input, cache and output) */
  tokens: number | null;
}

export interface WorkflowInfo {
  runId: string;
  /** The script's meta name, e.g. "agentos-next-build-phase" */
  name: string;
  status: "running" | "done" | "failed" | "stopped";
  /** The phase of the agent started last */
  phase: string | null;
  /** Every phase the script declares, in order (empty if unknown) */
  phases: string[];
  agents: WorkflowAgent[];
  startedAt: string;
  updatedAt: string;
}

interface Script {
  name: string;
  phases: string[];
}

/** Never changes once known; reading the transcript for it is costly */
const scriptCache = new Map<string, Script>();
interface AgentUsage {
  /** Bytes read so far: only what's been added since is read next time */
  offset: number;
  model: string | null;
  tokens: number | null;
}

/** By conversation file; a finished run's agents are read once */
const usageCache = new Map<string, AgentUsage>();

/** "claude-opus-5-5" as "Opus 5.5" */
export function modelName(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] && m[3].length < 3
    ? `${name} ${m[2]}.${m[3]}`
    : `${name} ${m[2]}`;
}

/** An agent's model and latest context, reading only the lines added since */
function agentUsage(file: string): AgentUsage {
  const prev = usageCache.get(file) ?? { offset: 0, model: null, tokens: null };
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return prev;
  }
  if (size <= prev.offset) return prev;
  const next = { ...prev };
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - prev.offset);
    fs.readSync(fd, buf, 0, buf.length, prev.offset);
    const text = buf.toString("utf8");
    // Only whole lines; a half-written one is read next time
    const end = text.lastIndexOf("\n");
    if (end < 0) return prev;
    for (const line of text.slice(0, end).split("\n")) {
      if (!line.includes('"usage"')) continue;
      try {
        const message = JSON.parse(line)?.message;
        const usage = message?.usage;
        if (
          typeof message?.model === "string" &&
          !message.model.startsWith("<")
        )
          next.model = modelName(message.model);
        if (usage)
          next.tokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.output_tokens ?? 0);
      } catch {}
    }
    next.offset = prev.offset + Buffer.byteLength(text.slice(0, end + 1));
  } finally {
    fs.closeSync(fd);
  }
  usageCache.set(file, next);
  return next;
}

/** Finished runs never change: read once, by run directory */
const finishedCache = new Map<string, WorkflowInfo>();
/** When a run's script wasn't found, so the transcript is read once a minute */
const missedAt = new Map<string, number>();

function sessionDir(transcriptFile: string): string {
  return transcriptFile.replace(/\.jsonl$/, "");
}

/**
 * A running workflow's script: the Workflow call's result in the transcript
 * names its file, "<name>-<first runId>.js", whose meta lists the phases
 */
function scriptFromTranscript(
  transcriptFile: string,
  runId: string
): Script | null {
  try {
    const text = fs.readFileSync(transcriptFile, "utf8");
    const at = text.indexOf(`${runId}\\nScript file: `);
    if (at < 0) return null;
    const m = /Script file: (\S+\/scripts\/(.+?)-wf_[\w-]+\.js)/.exec(
      text.slice(at, at + 1000)
    );
    if (!m) return null;
    let phases: string[] = [];
    try {
      const source = fs.readFileSync(m[1], "utf8");
      const meta = /phases:\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
      phases = [...meta.matchAll(/title:\s*['"]([^'"]+)['"]/g)].map(
        (t) => t[1]
      );
    } catch {}
    return { name: m[2], phases };
  } catch {
    return null;
  }
}

function summaryPhases(summary: Record<string, unknown>): string[] {
  const progress = Array.isArray(summary.workflowProgress)
    ? (summary.workflowProgress as Record<string, unknown>[])
    : [];
  return progress
    .filter((p) => p.type === "workflow_phase" && typeof p.title === "string")
    .map((p) => p.title as string);
}

function pick({ model, tokens }: AgentUsage) {
  return { model, tokens };
}

function readJournal(file: string) {
  const started = new Map<string, { label: string; phase: string | null }>();
  const finished = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { started, finished };
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const id = typeof event.agentId === "string" ? event.agentId : null;
    if (!id) continue;
    if (event.type === "started") {
      started.set(id, {
        label: typeof event.label === "string" ? event.label : "agent",
        phase: typeof event.phase === "string" ? event.phase : null,
      });
    } else if (event.type === "result") {
      finished.add(id);
    }
  }
  return { started, finished };
}

export function listWorkflows(transcriptFile: string): WorkflowInfo[] {
  const base = sessionDir(transcriptFile);
  const runsDir = path.join(base, "subagents", "workflows");
  let runIds: string[];
  try {
    runIds = fs.readdirSync(runsDir).filter((n) => n.startsWith("wf_"));
  } catch {
    return [];
  }
  const now = Date.now();
  const out: WorkflowInfo[] = [];
  for (const runId of runIds) {
    const dir = path.join(runsDir, runId);
    const cached = finishedCache.get(dir);
    if (cached) {
      out.push(cached);
      continue;
    }
    let summary: Record<string, unknown> | null = null;
    try {
      summary = JSON.parse(
        fs.readFileSync(path.join(base, "workflows", `${runId}.json`), "utf8")
      );
    } catch {}

    // First and last activity across the run's files
    let first = Infinity;
    let last = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        const stat = fs.statSync(path.join(dir, name));
        first = Math.min(first, stat.birthtimeMs || stat.mtimeMs);
        last = Math.max(last, stat.mtimeMs);
      }
    } catch {
      continue;
    }
    if (!last) continue;

    const { started, finished } = readJournal(path.join(dir, "journal.jsonl"));
    const live = now - last < STALE_MS;
    let status: WorkflowInfo["status"];
    if (summary) {
      status = summary.status === "completed" ? "done" : "failed";
      if (summary.status === "killed" || summary.status === "stopped")
        status = "stopped";
    } else status = live ? "running" : "stopped";

    const agents: WorkflowAgent[] = [...started].map(([agentId, s]) => ({
      agentId,
      label: s.label,
      phase: s.phase,
      ...pick(agentUsage(path.join(dir, `agent-${agentId}.jsonl`))),
      status: finished.has(agentId)
        ? "done"
        : status === "running"
          ? "running"
          : "stopped",
    }));

    let script = scriptCache.get(runId) ?? null;
    if (!script && typeof summary?.workflowName === "string")
      script = { name: summary.workflowName, phases: summaryPhases(summary) };
    if (!script && now - (missedAt.get(runId) ?? 0) > 60_000) {
      script = scriptFromTranscript(transcriptFile, runId);
      if (!script) missedAt.set(runId, now);
    }
    if (script) scriptCache.set(runId, script);

    const info: WorkflowInfo = {
      runId,
      name: script?.name ?? "Workflow",
      status,
      phase: agents.at(-1)?.phase ?? null,
      phases: script?.phases ?? [],
      agents,
      startedAt: new Date(first).toISOString(),
      updatedAt: new Date(last).toISOString(),
    };
    if (summary) finishedCache.set(dir, info);
    out.push(info);
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
