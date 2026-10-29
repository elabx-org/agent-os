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

/**
 * `text` lowercased with accents dropped ("Café" → "cafe", as the FTS
 * index's remove_diacritics), and for each of its UTF-16 units the offset
 * in `text` it came from (plus one past the end)
 */
export function foldText(text: string): { folded: string; from: number[] } {
  let folded = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      folded +=
        code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
      from.push(i);
      i++;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const char = String.fromCodePoint(cp);
    const out = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let n = 0; n < out.length; n++) from.push(i);
    folded += out;
    i += char.length;
  }
  from.push(text.length);
  return { folded, from };
}

/** A query word folded like foldText */
function foldTerm(term: string): string {
  return term.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Sorted, non-overlapping ranges of every term's occurrences in `text`,
 * case- and accent-insensitive (offsets into `text` as given)
 */
export function termRanges(text: string, query: string): HitRanges {
  const { folded, from } = foldText(text);
  const found: [number, number][] = [];
  for (const term of new Set(queryTerms(query).map(foldTerm))) {
    if (!term) continue;
    let at = folded.indexOf(term);
    while (at >= 0) {
      const end = at + term.length;
      // The end maps to just past the source character of the last unit
      const last = from[end - 1];
      const stop = Math.max(from[end], last + 1);
      found.push([from[at], stop]);
      at = folded.indexOf(term, end);
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
