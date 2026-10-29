/**
 * What the agent tree reads beside the subagents: which background agents
 * a session started, and the session's own model and context.
 *
 * Background agents (`claude --bg`) record no parent, so a link is only
 * made when all of these hold:
 * - it isn't an Agent-OS session sent to the background (agentOsSessionId:
 *   lists show that one as its session, never as anyone's child);
 * - it started after the session did;
 * - it runs in the session's folder (or its worktree), or below it;
 * - the session's own conversation names its id or its Claude session id
 *   (the `claude --bg` call's output, or a later `claude logs <id>`).
 * The last one rules out agents someone else started in the same folder.
 */

import fs from "fs";
import path from "path";
import type { Session } from "./db";
import type { BackgroundAgent } from "./claude-background";
import { dbTimeMs } from "./agent-state";
import { modelName } from "./claude-workflows";

const CHUNK = 4 * 1024 * 1024;
/** Kept between chunks so an id cut in two is still found */
const OVERLAP = 64;

function inside(dir: string | null | undefined, cwd: string): boolean {
  if (!dir || !cwd) return false;
  const rel = path.relative(dir, cwd);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The background agents linked to the session. `mentioned` is the set of
 * ids its conversation names; null skips that check (to pick the
 * candidates worth looking up).
 */
export function linkBackground(
  session: Session,
  agents: BackgroundAgent[],
  mentioned: Set<string> | null
): BackgroundAgent[] {
  const created = dbTimeMs(session.created_at);
  return agents.filter(
    (a) =>
      !a.agentOsSessionId &&
      (Number.isNaN(created) || a.startedAt >= created) &&
      (inside(session.working_directory, a.cwd) ||
        inside(session.worktree_path, a.cwd)) &&
      (!mentioned ||
        mentioned.has(a.id) ||
        (!!a.sessionId && mentioned.has(a.sessionId)))
  );
}

interface Mentions {
  /** Bytes searched for every id in `checked` */
  offset: number;
  checked: Set<string>;
  found: Set<string>;
}

const mentionCache = new Map<string, Mentions>();

export function resetMentionCache() {
  mentionCache.clear();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Search bytes [from, to) of the file for the ids, adding hits to `found` */
function scan(
  file: string,
  from: number,
  to: number,
  ids: string[],
  found: Set<string>
) {
  const left = ids.filter((id) => !found.has(id));
  if (!left.length || to <= from) return;
  const re = new RegExp(
    `(?<![\\w-])(${left.map(escape).join("|")})(?![\\w-])`,
    "g"
  );
  const fd = fs.openSync(file, "r");
  try {
    let pos = Math.max(0, from - OVERLAP);
    while (pos < to) {
      const buf = Buffer.alloc(Math.min(CHUNK, to - pos));
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      for (const m of buf.subarray(0, n).toString("utf8").matchAll(re))
        found.add(m[1]);
      if (pos + n >= to) break;
      pos += Math.max(1, n - OVERLAP);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Which of `ids` the conversation names. A new id costs one pass over the
 * file; after that only what was appended is searched.
 */
export function mentionedIds(file: string, ids: string[]): Set<string> {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return new Set();
  }
  const cached = mentionCache.get(file);
  const m: Mentions =
    cached && size >= cached.offset
      ? cached
      : { offset: 0, checked: new Set(), found: new Set() };
  const fresh = ids.filter((id) => !m.checked.has(id));
  try {
    if (fresh.length) scan(file, 0, m.offset, fresh, m.found);
    for (const id of fresh) m.checked.add(id);
    scan(file, m.offset, size, [...m.checked], m.found);
    m.offset = size;
  } catch {
    return new Set();
  }
  mentionCache.set(file, m);
  return new Set(ids.filter((id) => m.found.has(id)));
}

/** The end of the transcript searched for the latest usage */
const TAIL_BYTES = 512 * 1024;

const usageCache = new Map<
  string,
  { size: number; model: string | null; tokens: number | null }
>();

/**
 * The session's model and context at its latest turn, from the end of its
 * transcript; kept from the last read when the end has no turn
 */
export function sessionUsage(file: string): {
  model: string | null;
  tokens: number | null;
} {
  const prev = usageCache.get(file);
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { model: null, tokens: null };
  }
  if (prev && prev.size === size)
    return { model: prev.model, tokens: prev.tokens };
  const next = {
    size,
    model: prev?.model ?? null,
    tokens: prev?.tokens ?? null,
  };
  try {
    const from = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    let text: string;
    try {
      const buf = Buffer.alloc(size - from);
      const n = fs.readSync(fd, buf, 0, buf.length, from);
      text = buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      try {
        const message = JSON.parse(line)?.message;
        const model = typeof message?.model === "string" ? message.model : "";
        const u = message?.usage;
        if (!u || !model || model.startsWith("<")) continue;
        next.model = modelName(model);
        next.tokens =
          (u.input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.output_tokens ?? 0);
        break;
      } catch {
        // The first line of the tail is usually cut: skip it
      }
    }
  } catch {}
  usageCache.set(file, next);
  return { model: next.model, tokens: next.tokens };
}
