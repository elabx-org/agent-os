/**
 * One subagent's conversation file (subagents/agent-<id>.jsonl), read
 * incrementally: each call reads only the lines added since the last one
 * (like agentUsage in claude-workflows.ts) and keeps what the agent tree
 * and its detail pane need: the prompt, the latest tool calls, the files it
 * wrote and its latest usage. A finished agent's file is read once.
 */

import fs from "fs";
import path from "path";
import type { ToolCallSummary } from "./agent-tree-types";
import { modelName } from "./claude-workflows";

/** Prompts longer than this are cut (the pane shows a few lines) */
const PROMPT_CAP = 2000;
/** Tool calls kept, so a late result still finds its call */
const KEEP_TOOLS = 16;
/** Read this much at a time, so a big file never needs one big buffer */
const CHUNK = 4 * 1024 * 1024;

export interface AgentToolCall extends ToolCallSummary {
  id: string;
  /** The parent's view of an asking call: "Wants to run mockshot.js" */
  wants: string;
}

export interface AgentLog {
  /** Bytes read so far */
  offset: number;
  prompt: string | null;
  /** Latest calls, oldest first, at most KEEP_TOOLS */
  tools: AgentToolCall[];
  /** Tool calls so far */
  steps: number;
  /** Absolute path -> lines added/removed by its successful writes */
  files: Map<string, { added: number; removed: number }>;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  } | null;
  /** Raw model id of the latest turn ("claude-opus-5-5") */
  modelId: string | null;
  /** The model it was asked for, which carries "[1m]" for the long window */
  requestedModel: string | null;
  updatedAt: string | null;
  /** Writes waiting for their result, by tool call id */
  pendingWrites: Map<
    string,
    { file: string; added: number; removed: number }[]
  >;
  /** A fork's conversation starts with its parent's Agent call */
  forkHead: boolean;
  /** A user line seen yet (a fork's head comes before the first) */
  seenUser: boolean;
}

const cache = new Map<string, AgentLog>();

function emptyLog(): AgentLog {
  return {
    offset: 0,
    prompt: null,
    tools: [],
    steps: 0,
    files: new Map(),
    usage: null,
    modelId: null,
    requestedModel: null,
    updatedAt: null,
    pendingWrites: new Map(),
    forkHead: false,
    seenUser: false,
  };
}

/** For tests: forget what was read */
export function resetAgentLogCache() {
  cache.clear();
}

/** Lines in a string as an editor counts them ("a\nb\n" is 2) */
export function lineCount(text: string): number {
  if (!text) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** Lines an edit adds and removes, the unchanged head and tail left out */
export function editDelta(
  oldText: string,
  newText: string
): { added: number; removed: number } {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText ? newText.split("\n") : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  return { added: b.length - head - tail, removed: a.length - head - tail };
}

const INTERPRETERS = new Set([
  "node",
  "python",
  "python3",
  "bash",
  "sh",
  "zsh",
  "npx",
  "tsx",
  "bun",
  "deno",
  "sudo",
  "env",
  "time",
  "timeout",
]);

/**
 * A command's first words, safe to show: no leading `cd x &&`, no
 * `NAME=value` environment, the script's base name for `node x.js`, and
 * nothing from the first flag, `=`, quote or pipe on (where values live)
 */
export function commandTarget(command: string): string {
  // The first part that runs something: `X=1; cd y && node z.js` is z.js
  for (const part of command.split(/\s*(?:\|\||&&|\||;|\n)\s*/)) {
    const words = partWords(part);
    if (words.length && words[0] !== "cd") return words.join(" ");
  }
  return "";
}

function partWords(part: string): string[] {
  const words: string[] = [];
  for (const raw of part.trim().split(/\s+/)) {
    if (!raw) continue;
    if (words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue;
    if (/^-|[='"`$<>()\\]/.test(raw)) break;
    // The program and absolute paths by their base name
    const base =
      words.length === 0 || raw.startsWith("/") || raw.startsWith("~")
        ? path.basename(raw)
        : raw;
    // "node x.js": the script says more than the interpreter
    if (words.length === 0 && INTERPRETERS.has(base)) continue;
    if (words.length === 0 && /^\d+$/.test(base)) continue;
    words.push(base.length > 40 ? base.slice(0, 39) + "…" : base);
    if (words.length === 3) break;
  }
  return words;
}

const VERBS: Record<string, [past: string, now: string, wants: string]> = {
  Read: ["Read", "Reading", "read"],
  Write: ["Wrote", "Writing", "write"],
  Edit: ["Edited", "Editing", "edit"],
  MultiEdit: ["Edited", "Editing", "edit"],
  NotebookEdit: ["Edited", "Editing", "edit"],
  Bash: ["Ran", "Running", "run"],
  Grep: ["Searched", "Searching", "search"],
  Glob: ["Searched", "Searching", "search"],
  WebFetch: ["Fetched", "Fetching", "fetch"],
  WebSearch: ["Searched", "Searching", "search"],
  Agent: ["Started", "Starting", "start"],
  Task: ["Started", "Starting", "start"],
};

/** Read-only tools never ask for permission */
const READ_ONLY = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "TodoWrite",
  "WebSearch",
  "ToolSearch",
]);

export function canAsk(tool: string): boolean {
  return !READ_ONLY.has(tool);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A tool call as a row: its verb, and the file's name or the command */
export function summarizeTool(
  id: string,
  tool: string,
  input: Record<string, unknown>,
  at: string
): AgentToolCall {
  const verbs = VERBS[tool];
  let target = "";
  if (tool === "Bash") target = commandTarget(str(input.command));
  else if (str(input.file_path) || str(input.notebook_path))
    target = path.basename(str(input.file_path) || str(input.notebook_path));
  else if (tool === "Grep" || tool === "Glob") target = str(input.pattern);
  else if (tool === "Agent" || tool === "Task")
    target = str(input.description) || str(input.subagent_type);
  else if (tool === "WebFetch") {
    try {
      target = new URL(str(input.url)).hostname;
    } catch {}
  } else if (tool === "WebSearch") target = str(input.query);
  if (target.length > 60) target = target.slice(0, 59) + "…";
  // mcp__server__tool reads as its last part
  const shortTool = tool.startsWith("mcp__")
    ? (tool.split("__").pop() ?? tool)
    : tool;
  const [past, , wants] = verbs ?? ["Used", "Using", "use"];
  return {
    id,
    tool,
    verb: past,
    target: verbs ? target : target || shortTool,
    at,
    running: true,
    wants: `Wants to ${wants} ${
      tool === "Bash" ? (target.split(" ")[0] ?? "") : target || shortTool
    }`.trim(),
  };
}

/** The verb while it runs: "Writing" */
export function runningVerb(tool: string): string {
  return VERBS[tool]?.[1] ?? "Using";
}

/** Lines each write of a Write/Edit/MultiEdit call changes */
function writesOf(
  tool: string,
  input: Record<string, unknown>
): { file: string; added: number; removed: number }[] {
  const file = str(input.file_path);
  if (!file) return [];
  if (tool === "Write")
    return [{ file, added: lineCount(str(input.content)), removed: 0 }];
  if (tool === "Edit")
    return [
      { file, ...editDelta(str(input.old_string), str(input.new_string)) },
    ];
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of input.edits as Record<string, unknown>[]) {
      const d = editDelta(str(e?.old_string), str(e?.new_string));
      added += d.added;
      removed += d.removed;
    }
    return [{ file, added, removed }];
  }
  return [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

function capPrompt(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return t.length > PROMPT_CAP ? t.slice(0, PROMPT_CAP - 1) + "…" : t;
}

function applyLine(log: AgentLog, line: string) {
  // Most lines are attachments and snapshots: skip them unparsed
  if (
    !line.includes('"type":"user"') &&
    !line.includes('"type":"assistant"') &&
    !line.includes('"fork-context-ref"')
  )
    return;
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  if (entry.type === "fork-context-ref") {
    if (!log.seenUser) log.forkHead = true;
    return;
  }
  const at = str(entry.timestamp);
  if (at) log.updatedAt = at;
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return;
  const content = message.content;

  if (entry.type === "user") {
    const isFirst = !log.seenUser;
    log.seenUser = true;
    if (log.prompt === null && !(log.forkHead && isFirst))
      log.prompt = capPrompt(textOf(content));
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block?.type !== "tool_result") continue;
      const id = str(block.tool_use_id);
      const call = log.tools.find((t) => t.id === id);
      if (call) call.running = false;
      const writes = log.pendingWrites.get(id);
      if (writes) {
        log.pendingWrites.delete(id);
        if (block.is_error) continue;
        for (const w of writes) {
          const prev = log.files.get(w.file) ?? { added: 0, removed: 0 };
          log.files.set(w.file, {
            added: prev.added + w.added,
            removed: prev.removed + w.removed,
          });
        }
      }
    }
    return;
  }

  // assistant
  const model = str(message.model);
  if (model && !model.startsWith("<")) log.modelId = model;
  const requested = str(entry.requestedModel);
  if (requested) log.requestedModel = requested;
  const usage = message.usage as Record<string, number> | undefined;
  if (usage && model && !model.startsWith("<"))
    log.usage = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheCreation: usage.cache_creation_input_tokens ?? 0,
    };
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type !== "tool_use") continue;
    const input = (block.input ?? {}) as Record<string, unknown>;
    const name = str(block.name);
    // A fork begins with a copy of its parent's Agent call: that is its prompt
    if (
      log.forkHead &&
      !log.seenUser &&
      (name === "Agent" || name === "Task")
    ) {
      if (log.prompt === null) log.prompt = capPrompt(str(input.prompt));
      continue;
    }
    const id = str(block.id);
    log.steps++;
    log.tools.push(summarizeTool(id, name, input, at));
    if (log.tools.length > KEEP_TOOLS) log.tools.shift();
    const writes = writesOf(name, input);
    if (writes.length) log.pendingWrites.set(id, writes);
  }
}

/**
 * The conversation read so far, with what was appended since the last call
 * added; null if the file can't be read. Only whole lines are read: a
 * half-written one is read next time.
 */
export function readAgentLog(file: string): AgentLog | null {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return null;
  }
  let log = cache.get(file);
  // Rewritten shorter: start over
  if (!log || size < log.offset) log = emptyLog();
  if (size === log.offset) {
    cache.set(file, log);
    return log;
  }
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return log.offset ? log : null;
  }
  try {
    let pos = log.offset;
    let carry = Buffer.alloc(0);
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const data = carry.length
        ? Buffer.concat([carry, buf.subarray(0, n)])
        : buf.subarray(0, n);
      const end = data.lastIndexOf(0x0a);
      if (end < 0) {
        carry = Buffer.from(data);
        continue;
      }
      for (const line of data.subarray(0, end).toString("utf8").split("\n"))
        if (line) applyLine(log, line);
      carry = Buffer.from(data.subarray(end + 1));
      log.offset = pos - carry.length;
    }
  } finally {
    fs.closeSync(fd);
  }
  cache.set(file, log);
  return log;
}

/** "Opus 5.5" for the latest turn's model */
export function logModel(log: AgentLog): string | null {
  return log.modelId ? modelName(log.modelId) : null;
}

/** Context at the latest turn */
export function logTokens(log: AgentLog): number | null {
  const u = log.usage;
  return u ? u.input + u.output + u.cacheRead + u.cacheCreation : null;
}

/** 1M for a [1m] model or a context already past 200k, else 200k */
export function contextWindowFor(log: AgentLog): number {
  const tokens = logTokens(log) ?? 0;
  const ids = `${log.modelId ?? ""} ${log.requestedModel ?? ""}`;
  return /\[1m\]/i.test(ids) || tokens > 200_000 ? 1_000_000 : 200_000;
}

/** The latest call as the tree shows it */
export function lastTool(log: AgentLog): ToolCallSummary | null {
  const t = log.tools.at(-1);
  return t ? publicTool(t) : null;
}

export function publicTool(t: AgentToolCall): ToolCallSummary {
  return {
    tool: t.tool,
    verb: t.running ? runningVerb(t.tool) : t.verb,
    target: t.target,
    at: t.at,
    running: t.running,
  };
}
