/**
 * M11: the server side of GET /api/search, one function per section.
 * Messages come from search.db (U11.1); sessions, files and commands are
 * computed per request (U11.2).
 */

import type Database from "better-sqlite3";
import type { Session } from "../db";
import { getFlags } from "../flags";
import { openSearchDb } from "./db";
import { queryTerms, termRanges } from "./highlight";
import type {
  SearchCommand,
  SearchFileHit,
  SearchMessageHit,
  SearchSessionHit,
} from "./types";

/** About how many characters a message snippet shows */
const SNIPPET_CHARS = 90;
/** Of those, how many come before the first match */
const SNIPPET_LEAD = 24;

/** Words of the query in typed order, lowercased, without repeats */
function typedTerms(query: string): string[] {
  const terms = queryTerms(query);
  const typed = [...new Set(query.toLowerCase().split(/\s+/))];
  return typed.filter((word) => terms.includes(word));
}

/**
 * A safe FTS5 MATCH expression: every word a quoted string (quotes doubled,
 * so operators and brackets are plain text), the last one a prefix, all
 * ANDed. Null when no word has a letter or digit to match.
 */
export function matchExpression(query: string): string | null {
  const words = typedTerms(query).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (!words.length) return null;
  return words
    .map((word, n) => {
      const quoted = `"${word.replace(/"/g, '""')}"`;
      return n === words.length - 1 ? `${quoted}*` : quoted;
    })
    .join(" AND ");
}

/** Grapheme clusters with their UTF-16 offsets (emoji and accents whole) */
function graphemes(text: string): { segment: string; index: number }[] {
  const Segmenter = (Intl as any).Segmenter;
  if (Segmenter) {
    return Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (s: any) => ({ segment: s.segment as string, index: s.index as number })
    );
  }
  const out: { segment: string; index: number }[] = [];
  let index = 0;
  for (const segment of Array.from(text)) {
    out.push({ segment, index });
    index += segment.length;
  }
  return out;
}

/**
 * One line of `text` around the query's first match, about SNIPPET_CHARS
 * long, "…" where it was cut. Never splits a character.
 */
export function messageSnippet(text: string, query: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const parts = graphemes(line);
  if (parts.length <= SNIPPET_CHARS) return line;

  const first = termRanges(line, query)[0]?.[0] ?? 0;
  let at = parts.findIndex((p) => p.index + p.segment.length > first);
  if (at < 0) at = 0;

  let start = Math.max(0, at - SNIPPET_LEAD);
  start = Math.min(start, parts.length - SNIPPET_CHARS);
  // Begin on a word when one starts close by
  if (start > 0) {
    for (let n = start; n < Math.min(at, start + 12); n++) {
      if (parts[n].segment === " ") {
        start = n + 1;
        break;
      }
    }
  }
  const end = Math.min(parts.length, start + SNIPPET_CHARS);
  const body = parts
    .slice(start, end)
    .map((p) => p.segment)
    .join("")
    .trim();
  return `${start > 0 ? "…" : ""}${body}${end < parts.length ? "…" : ""}`;
}

interface MessageRow {
  session_id: string;
  role: string;
  ts: string;
  item_id: string;
  text: string;
}

/** The FTS query on an open index (searchMessages without the flag) */
export function queryMessages(
  db: Database.Database,
  query: string,
  opts: { limit: number; sessions: Session[] }
): SearchMessageHit[] {
  const match = matchExpression(query);
  if (!match || !opts.sessions.length || opts.limit <= 0) return [];
  const byId = new Map(opts.sessions.map((s) => [s.id, s]));
  const rows = db
    .prepare(
      `SELECT session_id, role, ts, item_id, text FROM search_messages
       WHERE search_messages MATCH ?
         AND session_id IN (SELECT value FROM json_each(?))
       ORDER BY ts DESC LIMIT ?`
    )
    .all(match, JSON.stringify([...byId.keys()]), opts.limit) as MessageRow[];

  return rows.flatMap((row) => {
    const session = byId.get(row.session_id);
    if (!session) return [];
    const snippet = messageSnippet(row.text, query);
    return [
      {
        sessionId: row.session_id,
        sessionName: session.name,
        agentType: session.agent_type || "claude",
        role: row.role === "user" ? "user" : "assistant",
        snippet,
        ranges: termRanges(snippet, query),
        ts: row.ts,
        itemId: row.item_id,
      } satisfies SearchMessageHit,
    ];
  });
}

/**
 * FTS5 match over indexed messages, newest first, sessions that no longer
 * exist dropped. Null when the index is off or unreadable (the response's
 * messagesEnabled false). Owned by U11.1.
 */
export function searchMessages(
  query: string,
  opts: { limit: number; sessions: Session[] }
): SearchMessageHit[] | null {
  try {
    if (!getFlags().searchIndex) return null;
  } catch {
    return null;
  }
  const db = openSearchDb();
  if (!db) return null;
  try {
    return queryMessages(db, query, opts);
  } catch (error) {
    console.error("[search] message query:", error);
    return null;
  }
}

// Sessions, files and commands are computed per request (U11.2)
export { searchCommands, searchFiles, searchSessions } from "./sections";
