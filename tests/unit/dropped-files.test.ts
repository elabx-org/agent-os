import test from "node:test";
import assert from "node:assert/strict";
import { carriesFiles, splitDropped } from "../../lib/dropped-files";

const file = (name: string, type: string) => ({ name, type });

test("pictures and videos go one way, other files the other", () => {
  const { media, others } = splitDropped([
    { kind: "file", file: file("a.png", "image/png") },
    { kind: "file", file: file("b.mov", "video/quicktime") },
    { kind: "file", file: file("notes.txt", "text/plain") },
    { kind: "file", file: file("Makefile", "") },
  ]);
  assert.deepEqual(
    media.map((f) => f.name),
    ["a.png", "b.mov"]
  );
  assert.deepEqual(
    others.map((f) => f.name),
    ["notes.txt", "Makefile"]
  );
});

test("a folder, dragged text and an empty entry are left out", () => {
  const { media, others } = splitDropped([
    { kind: "file", directory: true, file: file("Sources", "") },
    { kind: "string", file: null },
    { kind: "file", file: null },
  ]);
  assert.equal(media.length + others.length, 0);
});

test("only a drag with files is a file drop", () => {
  assert.equal(carriesFiles(["Files"]), true);
  assert.equal(carriesFiles(["text/plain", "text/uri-list"]), false);
  assert.equal(carriesFiles(undefined), false);
});
