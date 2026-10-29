/**
 * A session's summary for a handoff (M4; reused by M5, M8, M9, M11).
 * Extractive by default: the last asks, the conclusions, the files changed
 * (git) and the open plan (lib/claude-plan.ts) from the transcript found by
 * lib/transcript-locate.ts; `claude -p` only when asked and not limited;
 * the pane's scrollback for non-Claude agents.
 */

import { execFile, spawn } from "child_process";
import os from "os";
import { promisify } from "util";
import type { Session } from "./db";
import type { SessionSummary } from "./handoff-types";
import { readTranscriptTail, type ChatItem } from "./claude-transcript";
import { planFromItems, type PlanState } from "./claude-plan";
import { locateTranscript, sessionCwd } from "./transcript-locate";
import { tmuxNameOf } from "./session-launch";

const execFileAsync = promisify(execFile);

export interface SummarizeOptions {
  /** Condense with `claude -p` (uses quota); default extractive only */
  useModel?: boolean;
}

/** The whole message's cap: a first message, not a transcript */
export const MAX_SUMMARY_CHARS = 6000;
/** Enough of the transcript's end for the latest turns and the plan */
const TAIL_BYTES = 2_000_000;
const ASKS = 3;
const ASK_CHARS = 600;
const CONCLUSIONS = 2;
const CONCLUSION_CHARS = 1500;
const MAX_FILES = 40;
const MAX_STEPS = 20;
const SCROLLBACK_LINES = 500;
const SCROLLBACK_CHARS = 3000;
const GIT_TIMEOUT_MS = 5000;
const MODEL_TIMEOUT_MS = 90_000;
/** What `claude -p` gets of the conversation */
const MODEL_INPUT_CHARS = 60_000;

const AGENT_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

/** Rough token count of a text, as the sheet shows it */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ChangedFile {
  /** Porcelain XY, e.g. " M", "A ", "??" */
  code: string;
  path: string;
}

/** `git status --porcelain -z`: "XY path\0", a rename followed by its source */
export function parsePorcelain(stdout: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  const fields = stdout.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    out.push({ code, path: field.slice(3) });
    if (code.includes("R") || code.includes("C")) i++;
  }
  return out;
}

export interface ConversationExtract {
  /** The user's latest asks, oldest first */
  asks: string[];
  /** The final reply of each of the latest turns, oldest first */
  conclusions: string[];
  /** The summary a compaction continued from, when no ask follows it */
  compacted: string | null;
  plan: PlanState | null;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Slash commands and bare acknowledgements say nothing to the next agent */
function isAsk(text: string): boolean {
  return !!text.trim() && !text.trim().startsWith("/");
}

/** The asks, conclusions and plan in a transcript's chat items */
export function extractConversation(
  items: readonly ChatItem[]
): ConversationExtract {
  const turns: { ask: string; reply: string | null }[] = [];
  let compacted: string | null = null;
  for (const item of items) {
    if (item.kind === "summary") {
      compacted = item.text;
      turns.length = 0;
    } else if (item.kind === "user" && isAsk(item.text)) {
      turns.push({ ask: item.text, reply: null });
    } else if (item.kind === "assistant" && item.text.trim()) {
      if (!turns.length) turns.push({ ask: "", reply: null });
      turns[turns.length - 1].reply = item.text;
    }
  }
  const asks = turns
    .filter((t) => t.ask)
    .slice(-ASKS)
    .map((t) => clip(t.ask, ASK_CHARS));
  const conclusions = turns
    .filter((t) => t.reply)
    .slice(-CONCLUSIONS)
    .map((t) => clip(t.reply as string, CONCLUSION_CHARS));
  return {
    asks,
    conclusions,
    compacted: turns.length ? null : compacted,
    plan: planFromItems(items),
  };
}

export interface HandoffTextInput {
  agentType: string;
  name: string;
  cwd: string;
  branch: string | null;
  asks: string[];
  conclusions: string[];
  /** Free text in place of the conclusions: `claude -p`, a compaction, or the pane */
  body?: { title: string; text: string } | null;
  files: ChangedFile[];
  plan: PlanState | null;
}

const STEP_MARK = { done: "[x]", active: "[>]", todo: "[ ]" } as const;

/** The handoff message: self-contained, capped at MAX_SUMMARY_CHARS */
export function formatHandoff(input: HandoffTextInput): string {
  const agent = AGENT_NAMES[input.agentType] ?? input.agentType;
  const head = [
    `# Handoff from ${agent} session "${input.name}"`,
    "",
    "You are taking over work another agent session started in this folder. This is what it left.",
    "",
    `Folder: ${input.cwd}${input.branch ? ` (branch ${input.branch})` : ""}`,
  ].join("\n");

  const sections: string[] = [];
  if (input.asks.length) {
    sections.push(
      ["## What the user asked", ...input.asks.map((a) => `- ${a}`)].join("\n")
    );
  }
  if (input.body?.text.trim()) {
    sections.push(`## ${input.body.title}\n${input.body.text.trim()}`);
  }
  if (input.conclusions.length) {
    sections.push(`## Where it got to\n${input.conclusions.join("\n\n")}`);
  }
  if (input.plan) {
    const steps = input.plan.items.slice(0, MAX_STEPS);
    const more = input.plan.items.length - steps.length;
    sections.push(
      [
        `## Open plan (${input.plan.done} of ${input.plan.total} done)`,
        ...steps.map((s) => `- ${STEP_MARK[s.status]} ${s.text}`),
        ...(more > 0 ? [`- …and ${more} more`] : []),
      ].join("\n")
    );
  }
  if (input.files.length) {
    const shown = input.files.slice(0, MAX_FILES);
    const more = input.files.length - shown.length;
    sections.push(
      [
        `## Files changed (git status, ${input.files.length})`,
        ...shown.map((f) => `- ${f.code.trim() || "M"} ${f.path}`),
        ...(more > 0 ? [`- …and ${more} more`] : []),
      ].join("\n")
    );
  }
  const tail =
    "Check `git status` and `git diff` for the exact changes, then carry on from where it got to.";

  const room = MAX_SUMMARY_CHARS - head.length - tail.length - 4;
  let body = sections.join("\n\n");
  if (body.length > room) body = clip(body, Math.max(0, room));
  return [head, body, tail].filter(Boolean).join("\n\n");
}

/** The working tree's changes, without touching the index or HEAD */
export async function changedFiles(cwd: string): Promise<ChangedFile[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "--no-optional-locks",
        "-C",
        cwd,
        "status",
        "--porcelain",
        "-z",
        "--untracked-files=normal",
      ],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
    );
    return parsePorcelain(stdout);
  } catch {
    return [];
  }
}

async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: GIT_TIMEOUT_MS }
    );
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

/** The pane's recent output, plain text, or "" when its tmux is gone */
export async function captureScrollback(session: Session): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      [
        "capture-pane",
        "-p",
        "-J",
        "-S",
        `-${SCROLLBACK_LINES}`,
        "-t",
        `=${tmuxNameOf(session)}:`,
      ],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
    );
    return cleanScrollback(stdout);
  } catch {
    return "";
  }
}

/** Plain lines, runs of blank lines folded, the end kept */
export function cleanScrollback(raw: string, max = SCROLLBACK_CHARS): string {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]));
  const text = lines.join("\n").trim();
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

/** The conversation as plain text, for `claude -p` */
function conversationText(items: readonly ChatItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind === "user") lines.push(`User: ${item.text}`);
    else if (item.kind === "assistant") lines.push(`Assistant: ${item.text}`);
    else if (item.kind === "summary") lines.push(`Earlier: ${item.text}`);
    else if (item.kind === "tool") lines.push(`(${item.name} ${item.summary})`);
  }
  const text = lines.join("\n\n");
  return text.length > MODEL_INPUT_CHARS
    ? text.slice(text.length - MODEL_INPUT_CHARS)
    : text;
}

/**
 * `claude -p`, the conversation on stdin; null on any failure. Run outside
 * the session's folder: its own transcript would be the newest there, and
 * the status poll would take its id for the session
 */
function condense(conversation: string): Promise<string | null> {
  const prompt =
    "Summarize this coding-agent conversation for another agent taking it over, in under 300 words: what was asked, what was done, the current state and what is left. Be specific; name files.";
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("claude", ["-p", prompt], {
        cwd: os.tmpdir(),
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      done(null);
    }, MODEL_TIMEOUT_MS);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.on("error", () => done(null));
    child.on("close", (code) => done(code === 0 && out.trim() ? out : null));
    child.stdin?.on("error", () => {});
    child.stdin?.end(conversation);
  });
}

/**
 * At a usage limit, `claude -p` would fail or spend what's left. The
 * columns arrive with M6 (migration 29); until then nothing is limited
 */
function isLimited(session: Session): boolean {
  const s = session as Session & {
    limited_at?: number | null;
    limited_until?: number | null;
  };
  if (!s.limited_at) return false;
  return !s.limited_until || s.limited_until > Date.now();
}

export async function buildSummary(
  session: Session,
  options: SummarizeOptions = {}
): Promise<SessionSummary> {
  const agentType = session.agent_type || "claude";
  let cwd = sessionCwd(session);

  let items: ChatItem[] | null = null;
  if (agentType === "claude") {
    const located = await locateTranscript(session).catch(() => null);
    if (located?.file) {
      cwd = located.cwd || cwd;
      try {
        items = readTranscriptTail(located.file, cwd, TAIL_BYTES).items;
      } catch {
        items = null;
      }
    }
  }

  const [files, gitBranch] = await Promise.all([
    changedFiles(cwd),
    currentBranch(cwd),
  ]);
  const base = {
    agentType,
    name: session.name,
    cwd,
    branch: gitBranch ?? session.branch_name ?? null,
    files,
  };
  const finish = (
    text: string,
    plan: PlanState | null,
    source: SessionSummary["source"],
    empty = false
  ): SessionSummary => ({
    text,
    tokens: estimateTokens(text),
    filesChanged: files.map((f) => f.path),
    plan: plan ? { done: plan.done, total: plan.total } : null,
    source,
    empty,
  });

  const extract = items ? extractConversation(items) : null;
  const hasConversation =
    !!extract &&
    (extract.asks.length > 0 ||
      extract.conclusions.length > 0 ||
      !!extract.compacted);

  if (options.useModel && !isLimited(session) && (hasConversation || !items)) {
    const input =
      items && hasConversation
        ? conversationText(items)
        : await captureScrollback(session);
    const condensed = input.trim() ? await condense(input) : null;
    if (condensed) {
      const plan = extract?.plan ?? null;
      const text = formatHandoff({
        ...base,
        asks: extract?.asks.slice(-1) ?? [],
        conclusions: [],
        body: { title: "Summary", text: condensed },
        plan,
      });
      return finish(text, plan, "model");
    }
  }

  if (extract && hasConversation) {
    const text = formatHandoff({
      ...base,
      asks: extract.asks,
      conclusions: extract.conclusions,
      body: extract.compacted
        ? {
            title: "Earlier in the session",
            text: clip(extract.compacted, CONCLUSION_CHARS),
          }
        : null,
      plan: extract.plan,
    });
    return finish(text, extract.plan, "transcript");
  }

  // Codex, Gemini, or a Claude session whose transcript isn't there
  const scrollback = await captureScrollback(session);
  const plan = extract?.plan ?? null;
  const text = formatHandoff({
    ...base,
    asks: [],
    conclusions: [],
    body: scrollback
      ? {
          title: "Its terminal, last lines",
          text: "```\n" + scrollback + "\n```",
        }
      : {
          title: "Its conversation",
          text: "No transcript or terminal history was available. Ask the user what they were working on.",
        },
    plan,
  });
  return finish(text, plan, "scrollback", !scrollback && !plan);
}
