/**
 * Human titles for Claude sessions, read from their transcripts, so a row
 * can say what a session is about before "Session 24". Server only.
 *
 * Claude Code appends title entries (custom-title from /rename, ai-title,
 * summary, agent-name) through the transcript, so the tail has the latest
 * one; the head has the first prompt, the fallback for a fresh session.
 */

import fs from "fs";
import { findTranscript, readClaudeSessionMeta } from "./claude-transcript";

const HEAD_BYTES = 64_000;
const TAIL_BYTES = 256_000;
const MAX_TITLE = 60;
/** How long a tmux name → transcript lookup is trusted (one tmux call each) */
const LOOKUP_TTL_MS = 30_000;

type FileTitle = { mtimeMs: number; size: number; title: string | null };

const byFile = new Map<string, FileTitle>();
/** The first prompt never changes once written, so it's kept apart */
const firstPrompts = new Map<string, string>();
const lookups = new Map<
  string,
  { at: number; file: string | null; name?: string }
>();

function readSlice(fd: number, from: number, length: number): string {
  const buf = Buffer.alloc(length);
  const read = fs.readSync(fd, buf, 0, length, from);
  return buf.toString("utf8", 0, read);
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TITLE
    ? `${flat.slice(0, MAX_TITLE - 1).trimEnd()}…`
    : flat;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The latest title entry in the lines, by kind: a /rename wins */
function titleFromTail(lines: string[]): string | null {
  let ai: string | null = null;
  let agent: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    // Cheap filter: most lines are messages
    if (!line.includes('"type":"')) continue;
    if (
      !/"type":"(custom-title|ai-title|summary|agent-name)"/.test(
        line.slice(0, 200)
      )
    )
      continue;
    const entry = parse(line);
    if (!entry) continue;
    if (entry.type === "custom-title" && typeof entry.customTitle === "string")
      if (entry.customTitle.trim()) return entry.customTitle;
    if (!ai && entry.type === "ai-title" && typeof entry.aiTitle === "string")
      ai = entry.aiTitle;
    if (!ai && entry.type === "summary" && typeof entry.summary === "string")
      ai = entry.summary;
    if (
      !agent &&
      entry.type === "agent-name" &&
      typeof entry.agentName === "string"
    )
      agent = entry.agentName;
  }
  return ai?.trim() || agent?.trim() || null;
}

/** What the person first typed, skipping commands' and hooks' wrappers */
function firstPrompt(lines: string[]): string | null {
  for (const line of lines) {
    if (!line.includes('"type":"user"')) continue;
    const entry = parse(line);
    if (!entry || entry.type !== "user") continue;
    if (entry.isSidechain || entry.isMeta || entry.isCompactSummary) continue;
    if (entry.origin && entry.origin.kind !== "human") continue;
    const content = entry.message?.content;
    const raw =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((p: any) => p?.type === "text")
              .map((p: any) => p.text)
              .join("\n")
          : "";
    if (!raw.trim() || /^\s*</.test(raw)) continue;
    return raw;
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function readFileTitle(file: string): {
  title: string | null;
  prompt: string | null;
} {
  const stat = fs.statSync(file);
  const cached = byFile.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { title: cached.title, prompt: firstPrompts.get(file) ?? null };
  }

  const fd = fs.openSync(file, "r");
  try {
    const from = Math.max(0, stat.size - TAIL_BYTES);
    let lines = readSlice(fd, from, stat.size - from).split("\n");
    // A tail that starts mid-file starts mid-line
    if (from > 0) lines = lines.slice(1);
    const title = titleFromTail(lines);
    byFile.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, title });

    if (!title && !firstPrompts.has(file)) {
      const head = readSlice(fd, 0, Math.min(HEAD_BYTES, stat.size));
      const prompt = firstPrompt(head.split("\n"));
      if (prompt) firstPrompts.set(file, clip(prompt));
    }
    return { title, prompt: firstPrompts.get(file) ?? null };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The best title for the Claude session in a tmux pane, or null when there's
 * nothing better than its name. Never throws.
 */
export async function getSessionTitle(
  tmuxName: string
): Promise<string | null> {
  try {
    let lookup = lookups.get(tmuxName);
    if (!lookup || Date.now() - lookup.at > LOOKUP_TTL_MS) {
      const found = await findTranscript(tmuxName);
      lookup = { at: Date.now(), file: found?.file ?? null };
      lookups.set(tmuxName, lookup);
    }

    const fromFile = lookup.file
      ? readFileTitle(lookup.file)
      : { title: null, prompt: null };
    if (fromFile.title) return clip(fromFile.title);

    // The name other sessions reach it by, before the first prompt
    if (lookup.name === undefined) {
      const meta = await readClaudeSessionMeta(tmuxName);
      lookup.name = meta?.name?.trim() ?? "";
    }
    if (lookup.name) return clip(lookup.name);
    return fromFile.prompt;
  } catch {
    return null;
  }
}
