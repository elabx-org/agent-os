/**
 * Where a query's words match in a piece of text, case-insensitively, for
 * highlighting. No server imports: used by the route and the client.
 */

import type { HitRanges } from "./types";

/** The query's words, lowercased, longest first, empties dropped */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (word) seen.add(word);
  }
  return [...seen].sort((a, b) => b.length - a.length);
}

/** Sorted, non-overlapping ranges of every term's occurrences in `text` */
export function termRanges(text: string, query: string): HitRanges {
  const lower = text.toLowerCase();
  const found: [number, number][] = [];
  for (const term of queryTerms(query)) {
    let from = 0;
    while (from <= lower.length - term.length) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      found.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
