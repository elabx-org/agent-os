import { test } from "node:test";
import assert from "node:assert/strict";
import { findPaths } from "../../components/Terminal/hooks/path-links";

const findImagePaths = (rows: string[], first?: number) =>
  findPaths(rows, first).filter((f) => f.kind === "image");

const P = "/tmp/agent-os-screenshots/1793316200231-6ea7d318-IMG_7721.png";

test("a path on one row", () => {
  const [f] = findImagePaths([`  Reading ${P} now`]);
  assert.equal(f.path, P);
  assert.deepEqual(f.start, { row: 0, col: 10 });
  assert.deepEqual(f.end, { row: 0, col: 10 + P.length - 1 });
});

test("wrapped at a slash onto the next row", () => {
  const found = findImagePaths(
    [
      "> Why am I getting an error? /tmp/agent-os-screenshots",
      "  /1793316200231-6ea7d318-IMG_7721.png",
    ],
    20
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].path, P);
  assert.equal(found[0].start.row, 20);
  assert.deepEqual(found[0].end, { row: 21, col: 2 + 35 });
});

test("wrapped mid-word at the pane's edge, after a tree mark", () => {
  const found = findImagePaths([
    "  ⎿  /tmp/agent-os-screenshots/1793316200231-6ea7d318",
    "     -IMG_7721.png",
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].path, P);
});

test("quotes and punctuation stay out", () => {
  const [f] = findImagePaths([`see "${P}".`]);
  assert.equal(f.path, P);
  assert.equal(f.start.col, 5);
});

test("a path that isn't a picture, and a folder not followed by one", () => {
  assert.deepEqual(findImagePaths(["/tmp/notes.txt", "/etc/hosts"]), []);
  assert.deepEqual(findImagePaths(["cd /tmp/foo", "ls"]), []);
});

test("home paths count", () => {
  const [f] = findImagePaths(["~/shots/a.JPG"]);
  assert.equal(f.path, "~/shots/a.JPG");
});

test("source files, with a line", () => {
  const found = findPaths([
    "⏺ Update(components/Chat/ToolCard.tsx)",
    "  see lib/db.ts:42 and ./app/api/running/[pid]/route.ts:7:3.",
    "  package.json changed",
  ]);
  assert.deepEqual(
    found.map((f) => [f.path, f.line]),
    [
      ["components/Chat/ToolCard.tsx", undefined],
      ["lib/db.ts", 42],
      ["./app/api/running/[pid]/route.ts", 7],
      ["package.json", undefined],
    ]
  );
  assert.deepEqual(found[1].start, { row: 1, col: 6 });
  assert.deepEqual(found[1].end, {
    row: 1,
    col: 6 + "lib/db.ts:42".length - 1,
  });
});

test("URLs, versions and words aren't files", () => {
  assert.deepEqual(
    findPaths(["https://x.dev/a.js v1.2.3 e.g. done. 3.5 node@20"]),
    []
  );
});

test("a file path wrapped at a slash", () => {
  const [f] = findPaths([
    "  edited components/Terminal/hooks",
    "  /path-links.ts:12",
  ]);
  assert.equal(f.path, "components/Terminal/hooks/path-links.ts");
  assert.equal(f.line, 12);
});
