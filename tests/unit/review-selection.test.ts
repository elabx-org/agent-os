import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, type DiffLine } from "../../lib/diff-parser";
import { hunkLines } from "../../components/DiffViewer/diff-format";
import {
  commentFlow,
  isSelected,
  lineCount,
  nextSelection,
  quoteOf,
  rangeOf,
  sideOf,
  tapSelection,
  type LineSelection,
} from "../../components/DiffViewer/review-selection";

// old 1..4: one two three four; new 1..5: one 2 3 three four five
const EDIT =
  "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,4 +1,5 @@\n one\n-two\n+2\n+3\n three\n-four\n+four!\n+five\n";

const diff = parseDiff(EDIT);
const lines = hunkLines(diff.hunks[0]);
const find = (type: DiffLine["type"], content: string) =>
  lines.find((l) => l.type === type && l.content === content)!;
const P = "src/a.ts";

describe("sideOf", () => {
  test("a deletion is the old file's", () => {
    assert.deepEqual(sideOf(find("deletion", "two")), { side: "old", line: 2 });
  });
  test("an addition is the new file's", () => {
    assert.deepEqual(sideOf(find("addition", "3")), { side: "new", line: 3 });
  });
  test("a context line is the new file's", () => {
    assert.deepEqual(sideOf(find("context", "three")), {
      side: "new",
      line: 4,
    });
  });
  test("a context line without its new number is the old file's", () => {
    const line = { ...find("context", "three"), newLineNumber: null };
    assert.deepEqual(sideOf(line), { side: "old", line: 3 });
  });
  test("a header has no line", () => {
    const header: DiffLine = {
      type: "header",
      content: "@@",
      oldLineNumber: null,
      newLineNumber: null,
    };
    assert.equal(sideOf(header).line, null);
  });
});

describe("nextSelection", () => {
  const hit = (line: DiffLine, extend = false, path = P) => ({
    path,
    line,
    hunkIndex: 0,
    extend,
  });

  test("a tap picks one line", () => {
    assert.deepEqual(nextSelection(null, hit(find("addition", "2"))), {
      path: P,
      side: "new",
      startLine: 2,
      endLine: 2,
      anchor: 2,
    });
  });
  test("extend on the same side makes a range from the anchor", () => {
    const one = nextSelection(null, hit(find("addition", "five")))!;
    const two = nextSelection(one, hit(find("addition", "2"), true));
    assert.deepEqual(two, {
      path: P,
      side: "new",
      startLine: 2,
      endLine: 6,
      anchor: 6,
    });
    // Back past the anchor: still anchored there
    const three = nextSelection(two, hit(find("context", "three"), true));
    assert.deepEqual(rangeOf(three!), {
      path: P,
      side: "new",
      startLine: 4,
      endLine: 6,
    });
  });
  test("extend onto the other side starts fresh", () => {
    const one = nextSelection(null, hit(find("addition", "2")))!;
    assert.deepEqual(nextSelection(one, hit(find("deletion", "two"), true)), {
      path: P,
      side: "old",
      startLine: 2,
      endLine: 2,
      anchor: 2,
    });
  });
  test("extend into another file starts fresh", () => {
    const one = nextSelection(null, hit(find("addition", "2")))!;
    const other = nextSelection(one, hit(find("addition", "3"), true, "b.ts"));
    assert.equal(other!.path, "b.ts");
    assert.equal(other!.startLine, 3);
    assert.equal(other!.endLine, 3);
  });
  test("a header keeps what was selected", () => {
    const one = nextSelection(null, hit(find("addition", "2")));
    const header: DiffLine = {
      type: "header",
      content: "",
      oldLineNumber: null,
      newLineNumber: null,
    };
    assert.equal(nextSelection(one, hit(header)), one);
    assert.equal(nextSelection(null, hit(header)), null);
  });
});

describe("tapSelection", () => {
  const hit = (line: DiffLine, extend = false) => ({
    path: P,
    line,
    hunkIndex: 0,
    extend,
  });
  const one = nextSelection(null, hit(find("addition", "2")))!;

  test("a second tap on touch extends", () => {
    assert.deepEqual(
      rangeOf(tapSelection(one, hit(find("addition", "3")), true)!),
      { path: P, side: "new", startLine: 2, endLine: 3 }
    );
  });
  test("a second click with a mouse starts over", () => {
    const next = tapSelection(one, hit(find("addition", "3")), false)!;
    assert.equal(next.startLine, 3);
    assert.equal(next.endLine, 3);
  });
  test("a tap on the only selected line clears it", () => {
    assert.equal(tapSelection(one, hit(find("addition", "2")), true), null);
    assert.equal(tapSelection(one, hit(find("addition", "2")), false), null);
  });
  test("after a range, a tap starts over", () => {
    const range = tapSelection(one, hit(find("addition", "3")), true)!;
    const next = tapSelection(range, hit(find("addition", "five")), true)!;
    assert.deepEqual([next.startLine, next.endLine], [6, 6]);
  });
});

describe("isSelected", () => {
  const sel: LineSelection = {
    path: P,
    side: "new",
    startLine: 2,
    endLine: 4,
    anchor: 2,
  };
  test("lines of the side inside the range", () => {
    assert.equal(isSelected(sel, P, find("addition", "2")), true);
    assert.equal(isSelected(sel, P, find("context", "three")), true);
    assert.equal(isSelected(sel, P, find("addition", "five")), false);
  });
  test("not the other side's lines with the same numbers", () => {
    assert.equal(isSelected(sel, P, find("deletion", "two")), false);
  });
  test("not another file, not without a selection", () => {
    assert.equal(isSelected(sel, "b.ts", find("addition", "2")), false);
    assert.equal(isSelected(null, P, find("addition", "2")), false);
  });
});

describe("quoteOf", () => {
  test("the new side's lines in order, without signs", () => {
    assert.equal(
      quoteOf(diff, { path: P, side: "new", startLine: 2, endLine: 4 }),
      "2\n3\nthree"
    );
  });
  test("the old side: deletions and context", () => {
    assert.equal(
      quoteOf(diff, { path: P, side: "old", startLine: 1, endLine: 4 }),
      "one\ntwo\nthree\nfour"
    );
  });
  test("a single line", () => {
    assert.equal(
      quoteOf(diff, { path: P, side: "new", startLine: 6, endLine: 6 }),
      "five"
    );
  });
});

describe("lineCount and commentFlow", () => {
  test("lines in a range", () => {
    assert.equal(
      lineCount({ path: P, side: "new", startLine: 24, endLine: 25 }),
      2
    );
  });
  test("the desktop collects, everything else sends at once", () => {
    assert.equal(commentFlow("desktop"), "tray");
    assert.equal(commentFlow("duo-open"), "immediate");
    assert.equal(commentFlow("duo-closed"), "immediate");
    assert.equal(commentFlow("phone"), "immediate");
  });
});
