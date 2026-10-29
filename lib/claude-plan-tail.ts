/**
 * The plan route's reads of a transcript (GET /api/sessions/[id]/plan,
 * polled every 5s per open session): the tail once, then only what was
 * appended since, keeping just the entries the plan and the token count
 * come from. A plan stays found however far back its calls are.
 */

import fs from "fs/promises";
import { PLAN_TOOLS, planFromEntries, type PlanResponse } from "./claude-plan";

/** Enough of the tail for the latest todos and the last message's usage */
const TAIL_BYTES = 2_000_000;
/** Transcripts remembered at once (open sessions) */
const MAX_FILES = 50;

interface Tail {
  /** Bytes read up to the end of the last whole line */
  offset: number;
  size: number;
  mtimeMs: number;
  /** Plan tool calls and their results, oldest first, nothing else */
  kept: unknown[];
  planIds: Set<string>;
  tokens: number | null;
  result: PlanResponse;
}

// On globalThis: one cache for the Next and server.ts copies of the module
const shared = globalThis as unknown as {
  __agentosPlanTails?: Map<string, Tail>;
};
const tails = (shared.__agentosPlanTails ??= new Map<string, Tail>());

/* eslint-disable @typescript-eslint/no-explicit-any -- transcript JSON */
/** Keeps what the plan needs from one entry; the usage goes to `tokens` */
function take(tail: Tail, raw: unknown): void {
  const entry = raw as any;
  if (!entry || entry.isSidechain || !entry.message) return;
  const content = entry.message.content;
  if (entry.type === "assistant") {
    const usage = entry.message.usage;
    if (usage && typeof usage.input_tokens === "number") {
      tail.tokens =
        usage.input_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
    }
    if (!Array.isArray(content)) return;
    const calls = content.filter(
      (part: any) => part?.type === "tool_use" && PLAN_TOOLS.has(part.name)
    );
    if (!calls.length) return;
    for (const call of calls) tail.planIds.add(String(call.id));
    tail.kept.push({
      type: "assistant",
      message: { content: calls },
    });
  } else if (entry.type === "user" && Array.isArray(content)) {
    const results = content.filter(
      (part: any) =>
        part?.type === "tool_result" &&
        tail.planIds.has(String(part.tool_use_id))
    );
    if (results.length)
      tail.kept.push({ type: "user", message: { content: results } });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Reads [from, size) and takes each whole line; returns the new offset */
async function readFrom(
  handle: fs.FileHandle,
  tail: Tail,
  from: number,
  size: number,
  midLine: boolean
): Promise<number> {
  const buf = Buffer.alloc(size - from);
  await handle.read(buf, 0, buf.length, from);
  const text = buf.toString("utf8");
  const end = text.lastIndexOf("\n");
  if (end < 0) return from;
  let lines = text.slice(0, end).split("\n");
  // Starting mid-file starts mid-line
  if (midLine) lines = lines.slice(1);
  for (const line of lines) {
    if (!line) continue;
    try {
      take(tail, JSON.parse(line));
    } catch {
      // Malformed
    }
  }
  return from + Buffer.byteLength(text.slice(0, end + 1), "utf8");
}

/** The plan and context size in a transcript, read incrementally */
export async function planOfTranscript(file: string): Promise<PlanResponse> {
  const handle = await fs.open(file, "r");
  try {
    const { size, mtimeMs } = await handle.stat();
    let tail = tails.get(file);
    // Rewritten shorter: start again
    if (tail && tail.size > size) tail = undefined;
    if (tail && tail.size === size && tail.mtimeMs === mtimeMs)
      return tail.result;

    if (!tail) {
      tail = {
        offset: 0,
        size: 0,
        mtimeMs: 0,
        kept: [],
        planIds: new Set(),
        tokens: null,
        result: { plan: null, tokens: null },
      };
      const from = Math.max(0, size - TAIL_BYTES);
      tail.offset = await readFrom(handle, tail, from, size, from > 0);
    } else if (size > tail.offset) {
      tail.offset = await readFrom(handle, tail, tail.offset, size, false);
    }
    tail.size = size;
    tail.mtimeMs = mtimeMs;
    tail.result = {
      plan: planFromEntries(tail.kept).plan,
      tokens: tail.tokens,
    };
    // Most recently used last, so the oldest goes first
    tails.delete(file);
    tails.set(file, tail);
    if (tails.size > MAX_FILES) tails.delete(tails.keys().next().value!);
    return tail.result;
  } finally {
    await handle.close();
  }
}
