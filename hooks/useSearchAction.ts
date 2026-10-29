"use client";

import type { SearchRequest } from "@/stores/searchActions";

/**
 * Takes this session's search request of `kind` while `active` (the view
 * showing), within SEARCH_REQUEST_TTL_MS, calls `take` once and clears it.
 * Owned by U11.4
 */
export function useSearchAction<K extends SearchRequest["kind"]>(
  sessionId: string,
  kind: K,
  active: boolean,
  take: (request: Extract<SearchRequest, { kind: K }>) => void
): void {
  void sessionId;
  void kind;
  void active;
  void take;
}
