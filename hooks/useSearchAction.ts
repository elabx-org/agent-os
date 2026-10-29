"use client";

import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import { searchRequestVerdict } from "@/components/Search/open-result";
import {
  clearSearchAction,
  SEARCH_REQUEST_TTL_MS,
  searchActionStore,
  type SearchRequest,
} from "@/stores/searchActions";

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
  const { request } = useSnapshot(searchActionStore);
  const takeRef = useRef(take);
  takeRef.current = take;

  useEffect(() => {
    // The store's own object, not the snapshot: cleared exactly once
    const current = searchActionStore.request;
    const verdict = searchRequestVerdict(
      current,
      sessionId,
      kind,
      active,
      SEARCH_REQUEST_TTL_MS
    );
    if (verdict === "wait" || !current) return;
    clearSearchAction();
    if (verdict === "take")
      takeRef.current(current as Extract<SearchRequest, { kind: K }>);
  }, [request, sessionId, kind, active]);
}
