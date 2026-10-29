import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, parseMultiDiff } from "../../lib/diff-parser";

// `git diff --cached -M` of: an empty new file, a new file, a deletion, a
// binary change, an edit, a pure rename to a name with a space, and a new
// file whose name git quotes
const MULTI =
  'diff --git a/blank.txt b/blank.txt\nnew file mode 100644\nindex 0000000..e69de29\ndiff --git a/fresh.txt b/fresh.txt\nnew file mode 100644\nindex 0000000..92d5444\n--- /dev/null\n+++ b/fresh.txt\n@@ -0,0 +1 @@\n+fresh\ndiff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\nindex b023018..0000000\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\ndiff --git a/img.bin b/img.bin\nindex 88768ef..3e3315e 100644\nBinary files a/img.bin and b/img.bin differ\ndiff --git a/keep.txt b/keep.txt\nindex 4cb29ea..ea14db2 100644\n--- a/keep.txt\n+++ b/keep.txt\n@@ -1,3 +1,4 @@\n one\n-two\n+2\n three\n+four\ndiff --git a/old.txt b/new name.txt\nsimilarity index 100%\nrename from old.txt\nrename to new name.txt\ndiff --git "a/tab\\tname.txt" "b/tab\\tname.txt"\nnew file mode 100644\nindex 0000000..c1b0730\n--- /dev/null\n+++ "b/tab\\tname.txt"\n@@ -0,0 +1 @@\n+x\n\\ No newline at end of file\n';

describe("parseMultiDiff", () => {
  const files = parseMultiDiff(MULTI);
  const byName = (name: string) => files.find((f) => f.newFile === name)!;

  test("one entry per file, in order", () => {
    assert.deepEqual(
      files.map((f) => f.newFile),
      [
        "blank.txt",
        "fresh.txt",
        "gone.txt",
        "img.bin",
        "keep.txt",
        "new name.txt",
        "tab\tname.txt",
      ]
    );
  });

  test("new files, empty ones too", () => {
    const blank = byName("blank.txt");
    assert.equal(blank.isNew, true);
    assert.equal(blank.hunks.length, 0);
    const fresh = byName("fresh.txt");
    assert.equal(fresh.isNew, true);
    assert.equal(fresh.oldFile, "fresh.txt");
    assert.equal(fresh.additions, 1);
  });

  test("a deletion", () => {
    const gone = byName("gone.txt");
    assert.equal(gone.isDeleted, true);
    assert.equal(gone.oldFile, "gone.txt");
    assert.equal(gone.deletions, 1);
  });

  test("binary", () => {
    const bin = byName("img.bin");
    assert.equal(bin.isBinary, true);
    assert.equal(bin.oldFile, "img.bin");
    assert.equal(bin.hunks.length, 0);
  });

  test("an edit matches parseDiff on its own, without a trailing blank line", () => {
    const keep = byName("keep.txt");
    assert.equal(keep.additions, 2);
    assert.equal(keep.deletions, 1);
    const lines = keep.hunks[0].lines;
    assert.equal(lines.length, 5);
    assert.deepEqual(lines[lines.length - 1], {
      type: "addition",
      content: "four",
      oldLineNumber: null,
      newLineNumber: 4,
    });
    const alone = MULTI.slice(
      MULTI.indexOf("diff --git a/keep.txt"),
      MULTI.indexOf("diff --git a/old.txt")
    );
    assert.deepEqual(parseDiff(alone.trimEnd()), keep);
  });

  test("a pure rename keeps both names", () => {
    const renamed = byName("new name.txt");
    assert.equal(renamed.isRenamed, true);
    assert.equal(renamed.oldFile, "old.txt");
    assert.equal(renamed.hunks.length, 0);
  });

  test("quoted names are unquoted", () => {
    const tab = byName("tab\tname.txt");
    assert.equal(tab.isNew, true);
    assert.equal(tab.oldFile, "tab\tname.txt");
    assert.equal(tab.additions, 1);
  });

  test("an octal-escaped UTF-8 name", () => {
    const [file] = parseMultiDiff(
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\nnew file mode 100644\nindex 0000000..1\n'
    );
    assert.equal(file.newFile, "café.txt");
    assert.equal(file.isNew, true);
  });

  test("empty input, or text before the first header", () => {
    assert.deepEqual(parseMultiDiff(""), []);
    assert.equal(parseMultiDiff("warning: x\n" + MULTI).length, 7);
  });
});
