import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { searchKeys } from "./keys";
import {
  MIN_QUERY,
  type SearchParams,
  type SearchResponse,
} from "@/lib/search/types";

/** How long typing settles before a search goes out */
export const SEARCH_DEBOUNCE_MS = 150;

/** The query string for GET /api/search: empty and default fields left out */
export function searchQueryString(params: SearchParams): string {
  const query = new URLSearchParams({ q: params.q.trim() });
  if (params.kind && params.kind !== "all") query.set("kind", params.kind);
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.sessionId) query.set("sessionId", params.sessionId);
  return query.toString();
}

/** GET /api/search */
export async function fetchSearch(
  params: SearchParams,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const res = await fetch(`/api/search?${searchQueryString(params)}`, {
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Search failed (${res.status})`);
  }
  return res.json();
}

/** `value`, once it has stopped changing for `ms` */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Debounced search while the palette or page is open: nothing below
 * MIN_QUERY characters, the previous results kept while the next load.
 */
export function useSearch(params: SearchParams, enabled: boolean) {
  const q = useDebounced(params.q.trim(), SEARCH_DEBOUNCE_MS);
  const settled: SearchParams = { ...params, q };
  return useQuery({
    queryKey: searchKeys.query(settled),
    queryFn: ({ signal }) => fetchSearch(settled, signal),
    enabled: enabled && q.length >= MIN_QUERY,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
