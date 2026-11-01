import { test } from "node:test";
import assert from "node:assert/strict";
import { rowRunsOn } from "../../components/Terminal/hooks/wrapped-links";

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
