import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  breadcrumb,
  escapeRegex,
  firstResult,
  mergeSearch,
  MAX_FILE_RESULTS,
  MAX_HITS_PER_FILE,
  newFileNameError,
  pushRecent,
  relativeTo,
} from "../../components/FileExplorer/files-search";

describe("mergeSearch", () => {
  test("files: changed first, folders and repeats dropped", () => {
    const r = mergeSearch(
      "/p",
      [
        { path: "lib/a.ts", kind: "match" },
        { path: "lib/", kind: "match" },
        { path: "c.ts", kind: "changed", status: " M" },
        { path: "lib/a.ts", kind: "recent" },
        { path: "b.ts", kind: "recent" },
      ],
      []
    );
    assert.deepEqual(r.files, [
      { path: "c.ts", changed: true },
      { path: "lib/a.ts", changed: false },
      { path: "b.ts", changed: false },
    ]);
    assert.deepEqual(r.text, []);
  });

  test("text hits grouped by file, ./ and root prefixes stripped", () => {
    const r = mergeSearch(
      "/p/",
      [{ path: "z.ts", kind: "changed" }],
      [
        { file: "./a.ts", line: 3, lineText: "  const x = 1;\n" },
        { file: "./z.ts", line: 9, lineText: "x()" },
        { file: "/p/a.ts", line: 7, lineText: "x" },
        { file: "./a.ts", line: 3, lineText: "dup" },
      ]
    );
    assert.deepEqual(r.text, [
      { path: "z.ts", changed: true, hits: [{ line: 9, text: "x()" }] },
      {
        path: "a.ts",
        changed: false,
        hits: [
          { line: 3, text: "const x = 1;" },
          { line: 7, text: "x" },
        ],
      },
    ]);
  });

  test("caps files, hits per file and long lines", () => {
    const suggest = Array.from({ length: 20 }, (_, i) => ({
      path: `f${i}.ts`,
      kind: "match" as const,
    }));
    const hits = Array.from({ length: 6 }, (_, i) => ({
      file: "./a.ts",
      line: i + 1,
      lineText: "y".repeat(400),
    }));
    const r = mergeSearch("/p", suggest, hits);
    assert.equal(r.files.length, MAX_FILE_RESULTS);
    assert.equal(r.text[0].hits.length, MAX_HITS_PER_FILE);
    assert.ok(r.text[0].hits[0].text.length <= 160);
    assert.ok(r.text[0].hits[0].text.endsWith("…"));
  });

  test("firstResult: a file name, else the first text hit", () => {
    assert.deepEqual(
      firstResult(mergeSearch("/p", [{ path: "a.ts", kind: "match" }], [])),
      { path: "a.ts" }
    );
    assert.deepEqual(
      firstResult(
        mergeSearch("/p", [], [{ file: "./b.ts", line: 4, lineText: "b" }])
      ),
      { path: "b.ts", line: 4 }
    );
    assert.equal(firstResult({ files: [], text: [] }), null);
  });
});

describe("path helpers", () => {
  test("relativeTo", () => {
    assert.equal(relativeTo("/p", "/p/a/b.ts"), "a/b.ts");
    assert.equal(relativeTo("/p", "./a.ts"), "a.ts");
    assert.equal(relativeTo("/p", "a.ts"), "a.ts");
    assert.equal(relativeTo("/p", "/px/a.ts"), "/px/a.ts");
  });

  test("escapeRegex makes ripgrep search literally", () => {
    assert.equal(escapeRegex("a.b(c)*"), "a\\.b\\(c\\)\\*");
  });

  test("pushRecent: newest first, no repeats, capped", () => {
    let list: string[] = [];
    for (const f of ["a", "b", "c", "a"]) list = pushRecent(list, f, 3);
    assert.deepEqual(list, ["a", "c", "b"]);
    list = pushRecent(list, "d", 3);
    assert.deepEqual(list, ["d", "a", "c"]);
  });

  test("breadcrumb inside and outside the project", () => {
    assert.deepEqual(breadcrumb("/w/agent-os", "/w/agent-os"), [
      { label: "agent-os", path: "/w/agent-os" },
    ]);
    assert.deepEqual(breadcrumb("/w/agent-os/", "/w/agent-os/components/x"), [
      { label: "agent-os", path: "/w/agent-os" },
      { label: "components", path: "/w/agent-os/components" },
      { label: "x", path: "/w/agent-os/components/x" },
    ]);
    assert.deepEqual(breadcrumb("/w/agent-os", "/w/agent-os-wt"), [
      { label: "/", path: "/" },
      { label: "w", path: "/w" },
      { label: "agent-os-wt", path: "/w/agent-os-wt" },
    ]);
  });

  test("newFileNameError", () => {
    assert.equal(newFileNameError("a.ts"), null);
    assert.equal(newFileNameError("sub dir/a.ts"), null);
    assert.ok(newFileNameError(""));
    assert.ok(newFileNameError("/etc/passwd"));
    assert.ok(newFileNameError("~/x"));
    assert.ok(newFileNameError("../x"));
    assert.ok(newFileNameError("a/../../x"));
    assert.ok(newFileNameError("a/"));
  });
});
