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
