/**
 * M11 (N-Search): what the phone and Duo search page shows for a response,
 * without React: the chips, which sections a chip shows and the count.
 */

import type { SearchResponse } from "@/lib/search/types";

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

/**
 * All, Sessions N, Messages N (only with the index on), Files N; a chip
 * with nothing to show is left out unless it's the selected one
 */
export function pageChips(
  res: SearchResponse | undefined,
  selected: PageFilter = "all"
): PageChip[] {
  const chips: PageChip[] = [
    { filter: "all", label: "All" },
    { filter: "sessions", label: "Sessions", n: res?.sessions.length },
  ];
  if (!res || res.messagesEnabled)
    chips.push({
      filter: "messages",
      label: "Messages",
      n: res?.messages.length,
    });
  chips.push({ filter: "files", label: "Files", n: res?.files.length });
  return chips.filter(
    (c) => c.filter === "all" || c.filter === selected || c.n !== 0
  );
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
