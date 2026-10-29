import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, type DiffLine } from "../../lib/diff-parser";
import { asOldSide, pairRows } from "../../components/DiffViewer/split-rows";
import { sideOf } from "../../components/DiffViewer/review-selection";
import { diffPath } from "../../components/DiffViewer/diff-format";

const EDIT =
  "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,6 +1,7 @@\n one\n-two\n-three\n+2\n four\n+added\n five\n-six\n-seven\n+6\n";

const show = (l: DiffLine | null) =>
  l
    ? `${l.type[0]}${l.type === "deletion" ? l.oldLineNumber : (l.newLineNumber ?? l.oldLineNumber)}:${l.content}`
    : "-";

describe("pairRows", () => {
  const rows = pairRows(parseDiff(EDIT).hunks[0]);
  test("deletions pair with the additions after them, fillers on the short side", () => {
    assert.deepEqual(
      rows.map((r) => [show(r.left), show(r.right)]),
      [
        ["c1:one", "c1:one"],
        ["d2:two", "a2:2"],
        ["d3:three", "-"],
        ["c4:four", "c3:four"],
        ["-", "a4:added"],
        ["c5:five", "c5:five"],
        ["d6:six", "a6:6"],
        ["d7:seven", "-"],
      ]
    );
  });
  test("the left context line reads as the old file's", () => {
    const four = rows[3];
    assert.deepEqual(sideOf(four.left!), { side: "old", line: 4 });
    assert.deepEqual(sideOf(four.right!), { side: "new", line: 3 });
  });
  test("no trailing blank row from the diff's final newline", () => {
    assert.equal(rows.length, 8);
  });
  test("additions before deletions are not paired with them", () => {
    const d = parseDiff(
      "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n+new\n-old\n ctx\n"
    );
    assert.deepEqual(
      pairRows(d.hunks[0]).map((r) => [show(r.left), show(r.right)]),
      [
        ["-", "a1:new"],
        ["d1:old", "-"],
        ["c2:ctx", "c2:ctx"],
      ]
    );
  });
});

describe("asOldSide", () => {
  test("drops a context line's new number, leaves the rest", () => {
    const ctx: DiffLine = {
      type: "context",
      content: "x",
      oldLineNumber: 3,
      newLineNumber: 4,
    };
    assert.equal(asOldSide(ctx).newLineNumber, null);
    const add: DiffLine = { ...ctx, type: "addition", oldLineNumber: null };
    assert.equal(asOldSide(add), add);
  });
});

describe("diffPath", () => {
  test("an edit, a deletion, a new file", () => {
    assert.equal(diffPath(parseDiff(EDIT)), "src/a.ts");
    const gone = parseDiff(
      "--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n"
    );
    assert.equal(diffPath(gone), "gone.txt");
    const fresh = parseDiff(
      "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\n"
    );
    assert.equal(diffPath(fresh), "new.txt");
  });
});
