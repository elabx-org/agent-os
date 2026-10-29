/**
 * Reads a Claude Code session's JSONL transcript into chat items.
 *
 * Finding the transcript: the tmux pane's process is Claude Code, and Claude
 * Code records ~/.claude/sessions/<pid>.json with its sessionId and cwd. The
 * transcript is ~/.claude/projects/<cwd with non-alphanumerics as ->/<id>.jsonl.
 * This stays exact when several sessions share a folder.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { PLAN_TOOLS } from "./claude-plan";

const execFileAsync = promisify(execFile);

/** How much of a long transcript to read on first load */
const TAIL_BYTES = 1_500_000;
const MAX_ITEMS = 200;
const PREVIEW_CHARS = 400;
const MAX_PATCH_LINES = 120;
const MAX_PATCH_LINE = 240;

export type ChatItem =
  | { kind: "user"; id: string; text: string; ts: string }
  | { kind: "assistant"; id: string; text: string; ts: string }
  /** Where the conversation was compacted: the summary it continued from */
  | { kind: "summary"; id: string; text: string; ts: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      ts: string;
      /** An AskUserQuestion's first question, for replying with context */
      ask?: AskQuestion;
      /** A plan tool's input (TodoWrite, TaskCreate, TaskUpdate): lib/claude-plan */
      input?: unknown;
    }
  | {
      kind: "result";
      id: string;
      toolUseId: string;
      isError: boolean;
      preview: string;
      added?: number;
      removed?: number;
      /** The edit's lines, prefixed "+", "-" or " " (capped) */
      patch?: string[];
      /** A Workflow call's run, "wf_…" */
      runId?: string;
    };

export interface AskQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
}

export interface TranscriptChunk {
  sessionId: string;
  items: ChatItem[];
  /** Byte offset to pass as `since` for the next poll */
  offset: number;
  /** Where these items begin: pass as `before` to read the history above */
  start: number;
  /** Earlier history exists that wasn't read */
  truncated: boolean;
}

/**
 * The folder under <CLAUDE_CONFIG_DIR>/projects that holds a cwd's
 * transcripts: every character but a letter or digit becomes "-"
 */
export function projectDirFor(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/**
 * What Claude Code says about the session running in a tmux pane, from
 * ~/.claude/sessions/<pid>.json: its id, folder and the name other sessions
 * reach it by (ListAgents / SendMessage)
 */
export async function readClaudeSessionMeta(
  tmuxName: string
): Promise<{ sessionId: string; cwd: string; name?: string } | null> {
  let pid: string;
  try {
    const { stdout } = await execFileAsync("tmux", [
      "display-message",
      "-t",
      tmuxName,
      "-p",
      "#{pane_pid}",
    ]);
    pid = stdout.trim();
  } catch {
    return null;
  }
  if (!/^\d+$/.test(pid)) return null;

  let meta: SessionMeta;
  try {
    meta = JSON.parse(
      fs.readFileSync(path.join(claudeDir(), "sessions", `${pid}.json`), "utf8")
    );
  } catch {
    return null;
  }
  // Sent to the background ("parked"), the conversation goes on as a
  // background job under a new id; the pane's process still names the old one
  if (typeof meta.parkedJobId === "string") {
    const job = findBackgroundJob(meta.parkedJobId);
    if (job) meta = job;
  }
  const { sessionId, cwd } = meta;
  if (!sessionId || !cwd || !/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  const name = typeof meta.name === "string" ? meta.name : undefined;
  return { sessionId, cwd, name };
}

type SessionMeta = {
  sessionId?: string;
  cwd?: string;
  name?: unknown;
  parkedJobId?: unknown;
  jobId?: unknown;
};

function findBackgroundJob(jobId: string): SessionMeta | null {
  const dir = path.join(claudeDir(), "sessions");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const meta: SessionMeta = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8")
      );
      if (meta.jobId === jobId) return meta;
    } catch {
      // A file being rewritten: skip it
    }
  }
  return null;
}

export async function findTranscript(
  tmuxName: string
): Promise<{ sessionId: string; file: string | null; cwd: string } | null> {
  const meta = await readClaudeSessionMeta(tmuxName);
  if (!meta) return null;
  const { sessionId, cwd } = meta;

  const projects = path.join(claudeDir(), "projects");
  const direct = path.join(
    projects,
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${sessionId}.jsonl`
  );
  if (fs.existsSync(direct)) return { sessionId, file: direct, cwd };

  // Encoding differs in some versions: look the id up across projects
  for (const dir of fs.readdirSync(projects)) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return { sessionId, file, cwd };
  }
  // Claude Code writes the transcript with the first message
  return { sessionId, file: null, cwd };
}

function readRange(file: string, from: number, to: number): string {
  if (to <= from) return "";
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(to - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The latest history (no `since` or `before`), what was appended after
 * `since`, or the page of history that ends at `before`. A page is at most
 * TAIL_BYTES of file and MAX_ITEMS items, cut at a line so pages join up.
 */
export function readTranscript(
  file: string,
  sessionId: string,
  cwd: string,
  since?: number,
  before?: number,
  /** A subagent's own file, where every line is a side chain */
  subagent = false
): TranscriptChunk {
  const size = fs.statSync(file).size;
  const resume = since !== undefined && since >= 0 && since <= size;
  const end =
    !resume && before !== undefined && before >= 0 && before <= size
      ? before
      : size;
  let from = resume ? since : Math.max(0, end - TAIL_BYTES);

  let lines = readRange(file, from, end).split("\n");
  // A page that starts mid-file starts mid-line
  if (!resume && from > 0) {
    from += Buffer.byteLength(lines[0], "utf8") + 1;
    lines = lines.slice(1);
  }
  // Partial if it's still being written (empty after a final newline)
  const last = lines.pop() ?? "";
  const consumed = end - Buffer.byteLength(last, "utf8");

  const parsed: { at: number; items: ChatItem[] }[] = [];
  let at = from;
  for (const line of lines) {
    if (line) {
      try {
        parsed.push({ at, items: toItems(JSON.parse(line), cwd, subagent) });
      } catch {
        // Skip malformed lines
      }
    }
    at += Buffer.byteLength(line, "utf8") + 1;
  }

  // Keep whole lines from the end until the page is full
  let start = from;
  let first = 0;
  if (!resume) {
    let count = 0;
    for (let i = parsed.length - 1; i >= 0; i--) {
      if (count >= MAX_ITEMS) {
        start = parsed[i + 1].at;
        first = i + 1;
        break;
      }
      count += parsed[i].items.length;
    }
  }
  const items = parsed.slice(first).flatMap((p) => p.items);

  return {
    sessionId,
    items,
    offset: end === size ? consumed : size,
    start: resume ? (since ?? 0) : start,
    truncated: !resume && start > 0,
  };
}

/**
 * The items in the last `bytes` of a transcript, oldest first, for a quick
 * look at the latest turn. No paging: the first (partial) line is dropped.
 */
export function readTranscriptTail(
  file: string,
  cwd: string,
  bytes: number
): { items: ChatItem[]; whole: boolean } {
  const size = fs.statSync(file).size;
  const from = Math.max(0, size - bytes);
  let lines = readRange(file, from, size).split("\n");
  if (from > 0) lines = lines.slice(1);
  const items: ChatItem[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      items.push(...toItems(JSON.parse(line), cwd));
    } catch {
      // Malformed, or the last line still being written
    }
  }
  return { items, whole: from === 0 };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toItems(entry: any, cwd: string, subagent = false): ChatItem[] {
  if ((entry.isSidechain && !subagent) || entry.isMeta) return [];
  const msg = entry.message;
  if (!msg) return [];
  const ts: string = entry.timestamp ?? "";

  if (entry.type === "user") {
    if (entry.isCompactSummary && typeof msg.content === "string") {
      return [{ kind: "summary", id: entry.uuid, text: msg.content, ts }];
    }
    if (typeof msg.content === "string") {
      if (entry.origin && entry.origin.kind !== "human") return [];
      const text = userText(msg.content);
      return text ? [{ kind: "user", id: entry.uuid, text, ts }] : [];
    }
    if (!Array.isArray(msg.content)) return [];
    const out: ChatItem[] = [];
    const typed: string[] = [];
    for (const part of msg.content) {
      if (part.type === "tool_result") {
        out.push(toolResult(part, entry.toolUseResult, entry.uuid));
      } else if (part.type === "text") {
        typed.push(part.text);
      } else if (part.type === "image") {
        typed.push("[image]");
      }
    }
    if (typed.length && entry.origin?.kind !== "peer") {
      const text = userText(typed.join("\n"));
      if (text) out.push({ kind: "user", id: entry.uuid, text, ts });
    }
    return out;
  }

  if (entry.type === "assistant" && Array.isArray(msg.content)) {
    const out: ChatItem[] = [];
    msg.content.forEach((part: any, n: number) => {
      if (part.type === "text" && part.text?.trim()) {
        out.push({
          kind: "assistant",
          id: `${entry.uuid}-${n}`,
          text: part.text,
          ts,
        });
      } else if (part.type === "tool_use") {
        out.push({
          kind: "tool",
          id: part.id,
          name: part.name,
          summary: summarizeTool(part.name, part.input ?? {}, cwd),
          ts,
          ...(part.name === "AskUserQuestion" && {
            ask: askQuestion(part.input),
          }),
          ...(PLAN_TOOLS.has(part.name) && { input: part.input }),
        });
      }
    });
    return out;
  }
  return [];
}

/** The first of an AskUserQuestion's questions (the one on screen first) */
function askQuestion(input: any): AskQuestion | undefined {
  const q = Array.isArray(input?.questions) ? input.questions[0] : null;
  if (!q || typeof q.question !== "string") return undefined;
  return {
    question: q.question,
    header: typeof q.header === "string" ? q.header : undefined,
    options: (Array.isArray(q.options) ? q.options : [])
      .filter((o: any) => typeof o?.label === "string")
      .map((o: any) => ({
        label: o.label,
        description:
          typeof o.description === "string" ? o.description : undefined,
      })),
  };
}

/** Slash commands arrive wrapped in tags; command output and caveats are noise */
function userText(raw: string): string {
  const command = raw.match(/<command-name>([^<]+)<\/command-name>/);
  if (command) {
    const args = raw.match(/<command-args>([^<]*)<\/command-args>/)?.[1];
    return [command[1], args].filter(Boolean).join(" ");
  }
  if (/^\s*<(local-command|system-reminder|bash-|task-notification)/.test(raw))
    return "";
  return raw.trim();
}

function toolResult(part: any, meta: any, uuid: string): ChatItem {
  const content =
    typeof part.content === "string"
      ? part.content
      : Array.isArray(part.content)
        ? part.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n")
        : "";
  let added: number | undefined;
  let removed: number | undefined;
  let patch: string[] | undefined;
  if (meta && Array.isArray(meta.structuredPatch)) {
    added = 0;
    removed = 0;
    const lines: string[] = [];
    for (const hunk of meta.structuredPatch) {
      if (lines.length) lines.push("@");
      for (const l of hunk.lines ?? []) {
        if (l.startsWith("+")) added++;
        else if (l.startsWith("-")) removed++;
        lines.push(String(l).slice(0, MAX_PATCH_LINE));
      }
    }
    // A new file has no patch; count its lines
    if (meta.type === "create" && typeof meta.content === "string") {
      const created: string[] = meta.content.split("\n");
      added = created.length;
      lines.push(...created.map((l) => `+${l.slice(0, MAX_PATCH_LINE)}`));
    }
    patch = lines.length ? lines.slice(0, MAX_PATCH_LINES) : undefined;
  }
  // "Transcript dir: …/subagents/workflows/wf_…" in a Workflow call's result
  const runId = /\/subagents\/workflows\/(wf_[\w-]+)/.exec(content)?.[1];
  return {
    kind: "result",
    id: `${uuid}-${part.tool_use_id}`,
    toolUseId: part.tool_use_id,
    isError: !!part.is_error || !!meta?.interrupted,
    preview: content.slice(0, PREVIEW_CHARS),
    added,
    removed,
    patch,
    runId,
  };
}

function summarizeTool(name: string, input: any, cwd: string): string {
  const rel = (p: unknown) =>
    typeof p === "string" && p.startsWith(cwd + "/")
      ? p.slice(cwd.length + 1)
      : String(p ?? "");
  switch (name) {
    case "Bash":
      return String(input.command ?? "").split("\n")[0];
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return rel(input.file_path ?? input.notebook_path);
    case "Grep":
    case "Glob":
      return String(input.pattern ?? "");
    case "Agent":
    case "Task":
      return String(input.description ?? "");
    case "Workflow": {
      // The script's meta name, or its file's ("<name>-wf_….js")
      const script = String(input.script ?? "");
      const named = /name:\s*['"]([^'"]+)['"]/.exec(script)?.[1];
      const file = /([^/]+?)(?:-wf_[\w-]+)?\.js$/.exec(
        String(input.scriptPath ?? "")
      )?.[1];
      return named ?? file ?? String(input.name ?? "");
    }
    case "WebFetch":
      return String(input.url ?? "");
    case "WebSearch":
      return String(input.query ?? "");
    default: {
      const first = Object.values(input).find((v) => typeof v === "string");
      return typeof first === "string" ? first.split("\n")[0] : "";
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
