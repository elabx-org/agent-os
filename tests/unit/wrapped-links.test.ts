import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowRunsOn,
  urlAt,
} from "../../components/Terminal/hooks/wrapped-links";

const COLS = 40;
const full = (s: string) => s.padStart(COLS - 1, "x");

test("a URL broken at the edge runs on", () => {
  assert.equal(
    rowRunsOn(full("https://claude.ai/artifact/"), "  TJsLer", COLS),
    true
  );
  assert.equal(
    rowRunsOn(full("https://claude."), "  ai/artifact/x", COLS),
    true
  );
  assert.equal(rowRunsOn(full("https://x.io/a?q=1&"), "  page=2", COLS), true);
});

test("a full row that ends a sentence doesn't run into the next word", () => {
  assert.equal(
    rowRunsOn(full("https://claude.ai/artifact/TJs)."), "  Reply to it", COLS),
    false
  );
  assert.equal(
    rowRunsOn(full("https://x.io/a."), "  Then run it", COLS),
    false
  );
  assert.equal(rowRunsOn(full("(https://x.io/a)"), "  and more", COLS), false);
});

test("a short row or a spaced next row doesn't run on", () => {
  assert.equal(rowRunsOn("https://x.io/a", "  b", COLS), false);
  assert.equal(rowRunsOn(full("https://x.io/a"), "   ", COLS), false);
});

test("urlAt: the URL under a column of one row", () => {
  const row = "See https://claude.ai/artifact/abc for it.";
  assert.equal(urlAt([row], 0, 10, COLS), "https://claude.ai/artifact/abc");
  assert.equal(urlAt([row], 0, 33, COLS), "https://claude.ai/artifact/abc");
  assert.equal(urlAt([row], 0, 34, COLS), null);
  assert.equal(urlAt([row], 0, 1, COLS), null);
});

test("urlAt: a URL broken at the edge, tapped on either row", () => {
  const rows = [
    "  - Mocks tracker https://claude.ai/arti",
    "  fact/SeecS479EiWVuGVGi7SCuJ: you picked",
  ];
  const url = "https://claude.ai/artifact/SeecS479EiWVuGVGi7SCuJ";
  assert.equal(urlAt(rows, 0, 20, COLS), url);
  assert.equal(urlAt(rows, 1, 4, COLS), url);
  assert.equal(urlAt(rows, 1, 0, COLS), null);
  assert.equal(urlAt(rows, 1, 36, COLS), null);
});

test("urlAt: a closing bracket only when the URL opened one", () => {
  const row = "(https://a.b/c) and https://a.b/d_(e)";
  assert.equal(urlAt([row], 0, 3, 80), "https://a.b/c");
  assert.equal(urlAt([row], 0, 25, 80), "https://a.b/d_(e)");
});

test("a URL Claude Code wrapped short of the edge runs on into its rest", () => {
  // A tool's output, wrapped 5 columns short of a 53-column pane
  const rows = [
    "  ⎿  Updated ⧉ https://claude.ai/artifact/6gVXaa",
    "     Pw4mdrx4Car3BaLK",
    "    so there's no line where a page stops and the",
  ];
  const url = "https://claude.ai/artifact/6gVXaaPw4mdrx4Car3BaLK";
  assert.equal(rowRunsOn(rows[0], rows[1], 53), true);
  assert.equal(rowRunsOn(rows[1], rows[2], 53), false);
  assert.equal(urlAt(rows, 0, 20, 53), url);
  assert.equal(urlAt(rows, 1, 8, 53), url);
});

test("a URL ending short of the edge doesn't run into words or lists", () => {
  const row = "  See https://claude.ai/artifact/6gVXaaPw4m";
  assert.equal(rowRunsOn(row, "  for details", 48), false);
  assert.equal(rowRunsOn(row, "  2. Next step", 48), false);
  assert.equal(rowRunsOn(row, "  - a bullet", 48), false);
  assert.equal(rowRunsOn(row + ".", "  Xyz123", 48), false);
  // Too far short of the edge to have been wrapped
  assert.equal(rowRunsOn(row, "  Xyz123", 80), false);
  // Not a URL at the end
  assert.equal(
    rowRunsOn("  some words that end here ok", "  Xyz123", 33),
    false
  );
});
