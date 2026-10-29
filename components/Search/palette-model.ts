/**
 * The ⌘K palette's pure parts (D-Search): which rows show under which
 * filter, in which order, the Tab filter cycle and the highlight split.
 * No React, so the unit tests can run it.
 */

import type { Session } from "@/lib/db";
import { termRanges } from "@/lib/search/highlight";
import type {
  HitRanges,
  SearchResponse,
  SearchSessionHit,
} from "@/lib/search/types";
import type { SearchResult } from "./types";

/** The filters Tab cycles through ("tab Filter: All") */
export type PaletteFilter = "all" | "sessions" | "messages" | "files";

export const PALETTE_FILTERS: readonly PaletteFilter[] = [
  "all",
  "sessions",
  "messages",
  "files",
];

export const FILTER_LABEL: Record<PaletteFilter, string> = {
  all: "All",
  sessions: "Sessions",
  messages: "Messages",
  files: "Files",
};

/** Recent sessions shown before (or below the length of) a query */
export const RECENT_LIMIT = 8;

/**
 * The next filter on Tab (step 1) or Shift+Tab (step -1); Messages is
 * skipped while the index is off
 */
export function nextFilter(
  current: PaletteFilter,
  step: 1 | -1,
  messagesEnabled: boolean
): PaletteFilter {
  const filters = PALETTE_FILTERS.filter(
    (f) => messagesEnabled || f !== "messages"
  );
  const at = Math.max(0, filters.indexOf(current));
  return filters[(at + step + filters.length) % filters.length];
}

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) or ISO, in ms; 0 when unreadable */
function timeMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(
    /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : value.replace(" ", "T") + "Z"
  ).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The quick switcher part: the newest sessions (by updated_at), filtered by
 * name while a query is too short to search, as session hits
 */
export function recentSessionHits(
  sessions: readonly Session[],
  projectNames: Record<string, string>,
  query = "",
  limit = RECENT_LIMIT
): SearchSessionHit[] {
  const q = query.trim();
  return sessions
    .map((s) => ({ s, ranges: q ? termRanges(s.name || "", q) : [] }))
    .filter(({ ranges }) => !q || ranges.length > 0)
    .sort((a, b) => timeMs(b.s.updated_at) - timeMs(a.s.updated_at))
    .slice(0, limit)
    .map(({ s, ranges }) => ({
      id: s.id,
      name: s.name || "Unnamed session",
      agentType: s.agent_type || "claude",
      projectId: s.project_id,
      projectName: s.project_id ? (projectNames[s.project_id] ?? null) : null,
      branch: s.branch_name,
      updatedAt: s.updated_at,
      nameRanges: ranges,
    }));
}

/** The palette's sections, in display order */
export interface PaletteSections {
  sessions: SearchResult[];
  messages: SearchResult[];
  /** Turn actions on the current session ("Actions · <session>") */
  actions: SearchResult[];
  files: SearchResult[];
  /** Scripts and slash commands */
  commands: SearchResult[];
}

export const EMPTY_SECTIONS: PaletteSections = {
  sessions: [],
  messages: [],
  actions: [],
  files: [],
  commands: [],
};

/** A response as sections, under a filter (commands and actions: All only) */
export function paletteSections(
  data: SearchResponse | undefined,
  filter: PaletteFilter
): PaletteSections {
  if (!data) return EMPTY_SECTIONS;
  const show = (kind: PaletteFilter) => filter === "all" || filter === kind;
  const commands = filter === "all" ? data.commands : [];
  return {
    sessions: show("sessions")
      ? data.sessions.map((hit) => ({ kind: "session", hit }))
      : [],
    messages:
      show("messages") && data.messagesEnabled
        ? data.messages.map((hit) => ({ kind: "message", hit }))
        : [],
    actions: commands
      .filter((c) => c.kind === "action")
      .map((hit) => ({ kind: "command", hit })),
    files: show("files")
      ? data.files.map((hit) => ({ kind: "file", hit }))
      : [],
    commands: commands
      .filter((c) => c.kind !== "action")
      .map((hit) => ({ kind: "command", hit })),
  };
}

/** Every row in display order: what ↑/↓ move over and ↵ opens */
export function paletteRows(sections: PaletteSections): SearchResult[] {
  return [
    ...sections.sessions,
    ...sections.messages,
    ...sections.actions,
    ...sections.files,
    ...sections.commands,
  ];
}

/** A row's React key */
export function resultKey(result: SearchResult): string {
  switch (result.kind) {
    case "session":
      return `s:${result.hit.id}`;
    case "message":
      return `m:${result.hit.sessionId}:${result.hit.itemId}`;
    case "file":
      return `f:${result.hit.root}:${result.hit.path}`;
    case "command":
      return `c:${result.hit.id}`;
  }
}

/** ↑/↓ within the rows, stopping at either end */
export function moveSelection(index: number, step: number, count: number) {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + step));
}

/** One piece of highlighted text */
export interface HighlightPart {
  text: string;
  hit: boolean;
}

/**
 * `text` split at its ranges; ranges are clamped to the text, an overlap
 * keeps only its part past the previous range, empty ones are dropped
 */
export function highlightParts(
  text: string,
  ranges: HitRanges
): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let at = 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  for (const [rawStart, rawEnd] of sorted) {
    const start = Math.max(at, Math.min(rawStart, text.length));
    const end = Math.min(rawEnd, text.length);
    if (end <= start) continue;
    if (start > at) parts.push({ text: text.slice(at, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
