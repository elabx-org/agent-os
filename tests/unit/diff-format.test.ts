import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, parseMultiDiff } from "../../lib/diff-parser";
import {
  countsOf,
  diffBody,
  diffSummary,
  hunkLines,
  lineNumberOf,
  lineText,
  splitPath,
} from "../../components/DiffViewer/diff-format";

const EDIT =
  "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,4 @@ export function a\n one\n-two\n+2\n three\n+four\n";

// An empty new file, a new file, a deletion, a binary change and a pure rename
const MULTI =
  "diff --git a/blank.txt b/blank.txt\nnew file mode 100644\nindex 0000000..e69de29\ndiff --git a/fresh.txt b/fresh.txt\nnew file mode 100644\nindex 0000000..92d5444\n--- /dev/null\n+++ b/fresh.txt\n@@ -0,0 +1 @@\n+fresh\ndiff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\nindex b023018..0000000\n--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-bye\n-now\ndiff --git a/img.bin b/img.bin\nindex 88768ef..3e3315e 100644\nBinary files a/img.bin and b/img.bin differ\ndiff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n";

describe("splitPath", () => {
  test("name over its folder", () => {
    assert.deepEqual(splitPath("components/Session/ActivityStrip.tsx"), {
      name: "ActivityStrip.tsx",
      folder: "components/Session",
    });
  });
  test("a file at the root has no folder", () => {
    assert.deepEqual(splitPath("README.md"), { name: "README.md", folder: "" });
  });
  test("a trailing slash is not an empty name", () => {
    assert.deepEqual(splitPath("lib/db/"), { name: "db", folder: "lib" });
  });
});

describe("countsOf", () => {
  test("one file", () => {
    assert.deepEqual(countsOf(parseDiff(EDIT)), { added: 2, removed: 1 });
  });
  test("summed over files", () => {
    assert.deepEqual(countsOf(parseMultiDiff(MULTI)), {
      added: 1,
      removed: 2,
    });
  });
  test("nothing", () => {
    assert.deepEqual(countsOf([]), { added: 0, removed: 0 });
  });
});

describe("diffSummary", () => {
  const [blank, fresh, gone, bin, moved] = parseMultiDiff(MULTI);
  test("each kind of file", () => {
    assert.equal(diffSummary(parseDiff(EDIT)), "+2 −1");
    assert.equal(diffSummary(fresh), "New file · +1");
    assert.equal(diffSummary(blank), "New file · +0");
    assert.equal(diffSummary(gone), "Deleted · −2");
    assert.equal(diffSummary(bin), "Binary");
    assert.equal(diffSummary(moved), "Renamed · +0 −0");
  });
});

describe("diffBody", () => {
  const [blank, fresh, gone, bin, moved] = parseMultiDiff(MULTI);
  test("an edit shows its hunks alone", () => {
    assert.deepEqual(diffBody(parseDiff(EDIT)), { caption: null, hunks: true });
  });
  test("a new file keeps its lines", () => {
    assert.deepEqual(diffBody(fresh), { caption: null, hunks: true });
  });
  test("one line instead of hunks for the rest", () => {
    assert.deepEqual(diffBody(blank), {
      caption: "Empty new file",
      hunks: false,
    });
    assert.deepEqual(diffBody(gone), {
      caption: "File deleted · 2 lines",
      hunks: false,
    });
    assert.deepEqual(diffBody(bin), {
      caption: "Binary file changed",
      hunks: false,
    });
    assert.deepEqual(diffBody(moved), {
      caption: "Renamed from old.txt",
      hunks: false,
    });
  });
  test("a rename with edits keeps its hunks under the caption", () => {
    const edited = { ...parseDiff(EDIT), isRenamed: true, oldFile: "a.ts" };
    assert.deepEqual(diffBody(edited), {
      caption: "Renamed from a.ts",
      hunks: true,
    });
  });
});

describe("lines", () => {
  const hunk = parseDiff(EDIT).hunks[0];
  const lines = hunkLines(hunk);
  test("without the function header or the final newline's blank line", () => {
    assert.equal(hunk.lines[0].type, "header");
    assert.equal(hunk.lines.at(-1)?.content, "");
    assert.equal(lines.length, 5);
  });
  test("a real blank context line stays", () => {
    const blank = parseDiff("@@ -1,2 +1,2 @@\n \n-a\n+b\n");
    assert.deepEqual(hunkLines(blank.hunks[0]).map(lineText), [
      " ",
      "-a",
      "+b",
    ]);
    const tail = parseDiff("@@ -1,2 +1,2 @@\n-a\n+b\n \n");
    assert.deepEqual(hunkLines(tail.hunks[0]).map(lineText), ["-a", "+b", " "]);
  });
  test("each line keeps its own sign", () => {
    assert.deepEqual(lines.map(lineText), [
      " one",
      "-two",
      "+2",
      " three",
      "+four",
    ]);
  });
  test("one gutter: the old number only for a deletion", () => {
    assert.deepEqual(lines.map(lineNumberOf), [1, 2, 2, 3, 4]);
  });
});
