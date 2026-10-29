import { useQuery } from "@tanstack/react-query";
import { searchKeys } from "./keys";
import {
  MIN_QUERY,
  type SearchParams,
  type SearchResponse,
} from "@/lib/search/types";

/** GET /api/search. Owned by U11.3 */
export async function fetchSearch(
  params: SearchParams,
  signal?: AbortSignal
): Promise<SearchResponse> {
  void params;
  void signal;
  throw new Error("M11 U11.3: fetchSearch not implemented");
}

/**
 * Debounced search while the palette or page is open: nothing below
 * MIN_QUERY characters, the previous results kept while the next load.
 * Owned by U11.3
 */
export function useSearch(params: SearchParams, enabled: boolean) {
  return useQuery({
    queryKey: searchKeys.query(params),
    queryFn: ({ signal }) => fetchSearch(params, signal),
    enabled: enabled && params.q.trim().length >= MIN_QUERY,
  });
}
