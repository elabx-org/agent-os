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
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      ts: string;
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
    };

export interface TranscriptChunk {
  sessionId: string;
  items: ChatItem[];
  /** Byte offset to pass as `since` for the next poll */
  offset: number;
  /** Earlier history exists that wasn't read */
  truncated: boolean;
}

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export async function findTranscript(
  tmuxName: string
): Promise<{ sessionId: string; file: string | null; cwd: string } | null> {
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

  let meta: { sessionId?: string; cwd?: string };
  try {
    meta = JSON.parse(
      fs.readFileSync(path.join(claudeDir(), "sessions", `${pid}.json`), "utf8")
    );
  } catch {
    return null;
  }
  const { sessionId, cwd } = meta;
  if (!sessionId || !cwd || !/^[0-9a-f-]{36}$/.test(sessionId)) return null;

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

export function readTranscript(
  file: string,
  sessionId: string,
  cwd: string,
  since?: number
): TranscriptChunk {
  const size = fs.statSync(file).size;
  const resume = since !== undefined && since >= 0 && since <= size;
  const start = resume ? since : Math.max(0, size - TAIL_BYTES);

  let text = "";
  if (size > start) {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  }

  let lines = text.split("\n");
  // A tail read starts mid-line; a partial last line is still being written
  if (!resume && start > 0) lines = lines.slice(1);
  const last = lines.pop() ?? "";
  const consumed = size - Buffer.byteLength(last, "utf8");

  const items: ChatItem[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      items.push(...toItems(JSON.parse(line), cwd));
    } catch {
      // Skip malformed lines
    }
  }

  return {
    sessionId,
    items: resume ? items : items.slice(-MAX_ITEMS),
    offset: consumed,
    truncated: !resume && (start > 0 || items.length > MAX_ITEMS),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toItems(entry: any, cwd: string): ChatItem[] {
  if (entry.isSidechain || entry.isMeta) return [];
  const msg = entry.message;
  if (!msg) return [];
  const ts: string = entry.timestamp ?? "";

  if (entry.type === "user") {
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
        });
      }
    });
    return out;
  }
  return [];
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
  return {
    kind: "result",
    id: `${uuid}-${part.tool_use_id}`,
    toolUseId: part.tool_use_id,
    isError: !!part.is_error || !!meta?.interrupted,
    preview: content.slice(0, PREVIEW_CHARS),
    added,
    removed,
    patch,
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
