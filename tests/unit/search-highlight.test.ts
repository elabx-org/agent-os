import { test } from "node:test";
import assert from "node:assert/strict";
import { queryTerms, termRanges } from "../../lib/search/highlight";

test("queryTerms: lowercased, deduped, longest first", () => {
  assert.deepEqual(queryTerms("  Undo   turn undo "), ["undo", "turn"]);
  assert.deepEqual(queryTerms(""), []);
});

test("termRanges: case-insensitive, every occurrence", () => {
  assert.deepEqual(termRanges("Undo turn, then UNDO", "undo"), [
    [0, 4],
    [16, 20],
  ]);
});

test("termRanges: adjacent and overlapping matches merge", () => {
  // "undo turn" as two words: "undo" [0,4], "turn" [5,9] stay apart
  assert.deepEqual(termRanges("undo turn", "undo turn"), [
    [0, 4],
    [5, 9],
  ]);
  // "turn" inside "turnover" and "over" overlap → one range
  assert.deepEqual(termRanges("turnover", "turno over"), [[0, 8]]);
  // touching ranges merge too
  assert.deepEqual(termRanges("abcd", "ab cd"), [[0, 4]]);
});

test("termRanges: no match, no ranges", () => {
  assert.deepEqual(termRanges("hello", "xyz"), []);
});
