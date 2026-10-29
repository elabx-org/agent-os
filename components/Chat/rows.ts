/**
 * The chat's rows from transcript items, the lines of a grouped tool card
 * and where turn cards go. Pure, so it's unit tested
 * (tests/unit/chat-rows.test.ts).
 */

import type { ChatItem } from "@/lib/claude-transcript";
import type { Turn } from "@/lib/turn-types";
import { PLAN_TOOLS } from "@/lib/claude-plan";

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type ResultItem = Extract<ChatItem, { kind: "result" }>;
export type Row =
  | Extract<ChatItem, { kind: "user" | "assistant" | "summary" }>
  | { kind: "tools"; id: string; tools: ToolItem[] };

/** Messages as rows, a run of tool calls as one; results by tool call */
export function buildRows(items: readonly ChatItem[]) {
  const results = new Map<string, ResultItem>();
  const rows: Row[] = [];
  for (const item of items) {
    if (item.kind === "result") {
      results.set(item.toolUseId, item);
    } else if (item.kind === "tool") {
      const last = rows[rows.length - 1];
      if (last?.kind === "tools") last.tools.push(item);
      else rows.push({ kind: "tools", id: item.id, tools: [item] });
    } else {
      rows.push(item);
    }
  }
  return { rows, results };
}

interface LineBase {
  /** The first call's id: a stable key */
  id: string;
  /** Some call in it has no result yet */
  running: boolean;
  /** Some call in it failed */
  error: boolean;
  /** When the first call started (ISO), for the running row's elapsed */
  ts: string;
}

/** One line of the tool card (Closed-Chat) */
export type ToolLine =
  | (LineBase & { kind: "read"; files: string[] })
  | (LineBase & { kind: "search"; patterns: string[] })
  | (LineBase & {
      kind: "edit";
      file: string;
      /** Write alone: the file was written whole */
      verb: "Edited" | "Wrote";
      added: number;
      removed: number;
      /** Every call's lines, "+", "-", " " or "@" between hunks */
      patch: string[];
      counted: boolean;
    })
  /** A type check, tests, lint or build run through Bash */
  | (LineBase & { kind: "check"; what: string; command: string })
  | (LineBase & { kind: "plan"; count: number })
  /** A subagent or workflow: its own row, when the session knows it */
  | (LineBase & { kind: "agent"; tool: ToolItem; result?: ResultItem })
  | (LineBase & { kind: "tool"; tool: ToolItem; result?: ResultItem });

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const AGENT_TOOLS = new Set(["Agent", "Task", "Workflow"]);

/** What a Bash command checks, by the words in it, or null */
export function checkKind(command: string): string | null {
  if (/\b(tsc|typecheck|type-check)\b/.test(command)) return "Type check";
  if (
    /\b(test|tests|vitest|jest|pytest|test:unit|test:e2e)\b/.test(command) ||
    /\btsx --test\b/.test(command)
  )
    return "Tests";
  if (/\b(eslint|lint)\b/.test(command)) return "Lint";
  if (/\b(next build|npm run build|cargo build|go build)\b/.test(command))
    return "Build";
  return null;
}

/** "✓ Type check passed", "Running tests", "Type check failed" */
export function checkLabel(line: { what: string } & LineBase): string {
  if (line.running) return `Running ${line.what.toLowerCase()}`;
  return `${line.what} ${line.error ? "failed" : "passed"}`;
}

/**
 * A run of tool calls as the card's lines: reads together ("Read 3 files"),
 * searches together, edits of one file in a row together with their +/−,
 * a type check / tests run as a verification line, plan updates as one
 */
export function toolLines(
  tools: readonly ToolItem[],
  results: ReadonlyMap<string, ResultItem>
): ToolLine[] {
  const lines: ToolLine[] = [];
  for (const tool of tools) {
    const result = results.get(tool.id);
    const base = {
      id: tool.id,
      running: !result,
      error: !!result?.isError,
      ts: tool.ts,
    };
    const last = lines[lines.length - 1];
    const join = (line: LineBase) => {
      line.running ||= base.running;
      line.error ||= base.error;
    };

    if (tool.name === "Read") {
      if (last?.kind === "read") {
        join(last);
        if (!last.files.includes(tool.summary)) last.files.push(tool.summary);
      } else lines.push({ ...base, kind: "read", files: [tool.summary] });
    } else if (tool.name === "Grep" || tool.name === "Glob") {
      if (last?.kind === "search") {
        join(last);
        last.patterns.push(tool.summary);
      } else lines.push({ ...base, kind: "search", patterns: [tool.summary] });
    } else if (EDIT_TOOLS.has(tool.name)) {
      const patch = result && !result.isError ? (result.patch ?? []) : [];
      const counted = result?.added !== undefined;
      if (last?.kind === "edit" && last.file === tool.summary) {
        join(last);
        if (tool.name !== "Write") last.verb = "Edited";
        last.added += result?.added ?? 0;
        last.removed += result?.removed ?? 0;
        last.counted ||= counted;
        if (patch.length) {
          if (last.patch.length) last.patch.push("@");
          last.patch.push(...patch);
        }
      } else {
        lines.push({
          ...base,
          kind: "edit",
          file: tool.summary,
          verb: tool.name === "Write" ? "Wrote" : "Edited",
          added: result?.added ?? 0,
          removed: result?.removed ?? 0,
          patch: [...patch],
          counted,
        });
      }
    } else if (tool.name === "Bash" && checkKind(tool.summary)) {
      lines.push({
        ...base,
        kind: "check",
        what: checkKind(tool.summary)!,
        command: tool.summary,
      });
    } else if (PLAN_TOOLS.has(tool.name)) {
      if (last?.kind === "plan") {
        join(last);
        last.count++;
      } else lines.push({ ...base, kind: "plan", count: 1 });
    } else if (AGENT_TOOLS.has(tool.name)) {
      lines.push({ ...base, kind: "agent", tool, result });
    } else {
      lines.push({ ...base, kind: "tool", tool, result });
    }
  }
  return lines;
}

/** Lines shown before "Show all": the first change with a line of context */
export const PATCH_PEEK = 4;

/** The mini-diff's first lines: from just above the first change */
export function patchPeek(lines: readonly string[], all: boolean): string[] {
  if (all) return [...lines];
  const first = Math.max(
    0,
    lines.findIndex((l) => l[0] === "+" || l[0] === "-") - 1
  );
  return lines.slice(first, first + PATCH_PEEK);
}

/** The last path segment: the card names a file, the title has its path */
export function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Turn starts and transcript stamps may differ by the hook's lag */
const TURN_SLACK_MS = 10_000;

/**
 * Where each turn's card goes: after the last row of its turn, i.e. just
 * before the next user message (or at the end). The turn's own prompt is
 * found by its transcript uuid, else by time (the latest user message at
 * or before its start). Turns not in the loaded rows, turns with nothing
 * changed and turns still running are left out. Keyed by the row id the
 * cards follow
 */
export function placeTurns(
  rows: readonly Row[],
  turns: readonly Turn[]
): Map<string, Turn[]> {
  const placed = new Map<string, Turn[]>();
  if (!rows.length) return placed;
  const userAt: { index: number; ms: number }[] = [];
  rows.forEach((row, index) => {
    if (row.kind === "user") userAt.push({ index, ms: Date.parse(row.ts) });
  });

  for (const turn of turns) {
    if (turn.endedAt === null || !turn.files.length) continue;
    let start = turn.transcriptUuid
      ? rows.findIndex((r) => r.kind === "user" && r.id === turn.transcriptUuid)
      : -1;
    if (start < 0 && turn.startedAt !== null) {
      // None: older than the loaded rows, its prompt isn't here
      const limit = turn.startedAt + TURN_SLACK_MS;
      const before = userAt.filter((u) => u.ms <= limit);
      if (before.length) start = before[before.length - 1].index;
    }
    if (start < 0) continue;
    const next = rows.findIndex((r, i) => i > start && r.kind === "user");
    const after = next < 0 ? rows.length - 1 : next - 1;
    const key = rows[after].id;
    const list = placed.get(key) ?? [];
    list.push(turn);
    placed.set(key, list);
  }
  for (const list of placed.values()) list.sort((a, b) => a.turnNo - b.turnNo);
  return placed;
}

/** A running call's time so far: "40s", "2m", "1h 3m" */
export function shortElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** How long a question has waited (E-Live): "0:52", "12:05" */
export function clockElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
