/**
 * M11 (N-Search): what the phone and Duo search page shows for a response,
 * without React: the chips, which sections a chip shows, the count, and the
 * recent sessions an empty query lists.
 */

import { dbTimeMs } from "@/lib/agent-state";
import type { Session } from "@/lib/db";
import type { SearchResponse, SearchSessionHit } from "@/lib/search/types";

/** The page's chips; commands show under All only */
export type PageFilter = "all" | "sessions" | "messages" | "files";

export type PageSection = "sessions" | "messages" | "files" | "commands";

export interface PageChip {
  filter: PageFilter;
  label: string;
  /** The section's count (none on All) */
  n?: number;
}

const SECTIONS: readonly PageSection[] = [
  "sessions",
  "messages",
  "files",
  "commands",
];

/** All, Sessions N, Messages N (only with the index on), Files N */
export function pageChips(res: SearchResponse | undefined): PageChip[] {
  const chips: PageChip[] = [{ filter: "all", label: "All" }];
  chips.push({
    filter: "sessions",
    label: "Sessions",
    n: res?.sessions.length,
  });
  if (!res || res.messagesEnabled)
    chips.push({
      filter: "messages",
      label: "Messages",
      n: res?.messages.length,
    });
  chips.push({ filter: "files", label: "Files", n: res?.files.length });
  return chips;
}

/** The sections a chip shows, in order, each only when it has rows */
export function visibleSections(
  res: SearchResponse | undefined,
  filter: PageFilter
): PageSection[] {
  if (!res) return [];
  return SECTIONS.filter(
    (s) =>
      (filter === "all" || filter === s) &&
      (s !== "messages" || res.messagesEnabled) &&
      res[s].length > 0
  );
}

/** "10 results": every row the page can show under All */
export function resultCount(res: SearchResponse | undefined): number {
  if (!res) return 0;
  return visibleSections(res, "all").reduce((n, s) => n + res[s].length, 0);
}

export function resultCountText(n: number): string {
  return n === 1 ? "1 result" : `${n} results`;
}

/** A filter whose chip went away (Messages, index off) falls back to All */
export function effectiveFilter(
  filter: PageFilter,
  res: SearchResponse | undefined
): PageFilter {
  return filter === "messages" && res && !res.messagesEnabled ? "all" : filter;
}

/** An empty query lists the latest sessions, as session cards */
export function recentSessionHits(
  sessions: readonly Session[],
  limit: number
): SearchSessionHit[] {
  const at = (s: Session) => {
    const ms = dbTimeMs(s.updated_at || s.created_at || "");
    return Number.isNaN(ms) ? 0 : ms;
  };
  return [...sessions]
    .sort((a, b) => at(b) - at(a))
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      name: s.name,
      agentType: s.agent_type || "claude",
      projectId: s.project_id,
      projectName: null,
      branch: s.branch_name,
      updatedAt: s.updated_at,
      nameRanges: [],
    }));
}

/** A message row's second line: "You · KeyboardBar haptics · 6m" */
export function messageMeta(
  role: "user" | "assistant",
  agent: string,
  sessionName: string,
  age: string
): string {
  return [role === "user" ? "You" : agent, sessionName, age]
    .filter(Boolean)
    .join(" · ");
}
