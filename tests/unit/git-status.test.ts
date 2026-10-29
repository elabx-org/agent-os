import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { discardChanges, getGitStatus } from "../../lib/git-status";
import { searchCode } from "../../lib/code-search";
import { g, tmpDir, write } from "./turns-fixture";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const root = tmpDir("git-status");
  dirs.push(root);
  g(root, "init", "-q", "-b", "main");
  g(root, "config", "user.email", "test@example.com");
  g(root, "config", "user.name", "Test");
  g(root, "config", "commit.gpgsign", "false");
  write(root, "a.txt", "a\n");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "init");
  return root;
}

describe("getGitStatus untracked files", () => {
  test("a new folder's files are listed one by one", () => {
    const root = repo();
    write(root, "src/new/one.ts", "1\n");
    write(root, "src/new/two.ts", "2\n");
    write(root, "loose.ts", "l\n");
    const paths = getGitStatus(root)
      .untracked.map((f) => f.path)
      .sort();
    assert.deepEqual(paths, ["loose.ts", "src/new/one.ts", "src/new/two.ts"]);
  });

  test("a huge new folder stays one entry", () => {
    const root = repo();
    const dir = path.join(root, "build");
    fs.mkdirSync(dir);
    for (let i = 0; i < 600; i++)
      fs.writeFileSync(path.join(dir, `f${i}.js`), "");
    assert.deepEqual(
      getGitStatus(root).untracked.map((f) => f.path),
      ["build/"]
    );
  });

  test("from a subfolder, paths stay relative to the repo's top", () => {
    const root = repo();
    write(root, "pkg/sub/new/x.ts", "x\n");
    const paths = getGitStatus(path.join(root, "pkg")).untracked.map(
      (f) => f.path
    );
    assert.deepEqual(paths, ["pkg/sub/new/x.ts"]);
  });
});

describe("discardChanges", () => {
  test("restores a tracked file and deletes an untracked one", () => {
    const root = repo();
    write(root, "a.txt", "changed\n");
    write(root, "new.txt", "n\n");
    discardChanges(root, "a.txt");
    discardChanges(root, "new.txt");
    assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf-8"), "a\n");
    assert.equal(fs.existsSync(path.join(root, "new.txt")), false);
  });

  test("a failed checkout throws and never deletes the tracked file", () => {
    const root = repo();
    write(root, "a.txt", "changed\n");
    // The agent's git holds the index
    fs.writeFileSync(path.join(root, ".git/index.lock"), "");
    assert.throws(() => discardChanges(root, "a.txt"));
    assert.equal(
      fs.readFileSync(path.join(root, "a.txt"), "utf-8"),
      "changed\n"
    );
  });
});

describe("searchCode", () => {
  test("finds text without blocking, and stops at maxResults", async () => {
    const root = repo();
    for (let i = 0; i < 20; i++) write(root, `f${i}.ts`, "needle\n");
    const hits = await searchCode(root, "needle", {
      maxResults: 5,
      contextLines: 0,
    });
    assert.equal(hits.length, 5);
  });

  test("an aborted search resolves empty", async () => {
    const root = repo();
    const abort = new AbortController();
    abort.abort();
    const hits = await searchCode(root, "a", { signal: abort.signal });
    assert.deepEqual(hits, []);
  });
});
