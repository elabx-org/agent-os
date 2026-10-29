import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  badgeOfPorcelain,
  clearGitBadgesCache,
  gitBadges,
  parsePorcelainZ,
} from "../../lib/file-git-status";
import { g, tmpDir, write } from "./turns-fixture";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => clearGitBadgesCache());

/** A committed tree, then one of each change */
function repo(): string {
  const root = tmpDir("badges");
  dirs.push(root);
  g(root, "init", "-q", "-b", "main");
  g(root, "config", "user.email", "test@example.com");
  g(root, "config", "user.name", "Test");
  g(root, "config", "commit.gpgsign", "false");
  write(root, "top.txt", "top\n");
  write(root, "src/mod.ts", "export const a = 1;\n");
  write(root, "src/gone.ts", "gone\n");
  write(root, "src/old name.ts", "renamed\n");
  write(root, "src/deep/inner/keep.ts", "keep\n");
  write(root, "clean/x.ts", "x\n");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "init");

  write(root, "src/mod.ts", "export const a = 2;\n"); // M
  write(root, "src/staged new.ts", "new\n"); // A (staged)
  g(root, "add", "src/staged new.ts");
  write(root, "src/deep/inner/untracked.ts", "u\n"); // ?
  fs.rmSync(path.join(root, "src/gone.ts")); // D
  g(root, "mv", "src/old name.ts", "src/new name.ts"); // R
  return root;
}

describe("parsePorcelainZ", () => {
  test("letters per XY, renames by their new path", () => {
    const out = [
      " M a.ts",
      "A  b.ts",
      "?? c d.ts",
      " D e.ts",
      "R  new.ts",
      "old.ts",
      "MM f.ts",
      "AM g.ts",
      "",
    ].join("\0");
    assert.deepEqual(parsePorcelainZ(out), [
      { path: "a.ts", badge: "M" },
      { path: "b.ts", badge: "A" },
      { path: "c d.ts", badge: "?" },
      { path: "e.ts", badge: "D" },
      { path: "new.ts", badge: "M" },
      { path: "f.ts", badge: "M" },
      { path: "g.ts", badge: "A" },
    ]);
  });

  test("deleted wins over the index's letter", () => {
    assert.equal(badgeOfPorcelain("AD"), "D");
    assert.equal(badgeOfPorcelain("MD"), "D");
    assert.equal(badgeOfPorcelain("C "), "A");
  });
});

describe("gitBadges", () => {
  test("M, A, ?, D and renames from the repository's top", async () => {
    const root = repo();
    const { files, dirtyDirs } = await gitBadges(root);
    const at = (rel: string) => files.get(path.join(root, rel));
    assert.equal(at("src/mod.ts"), "M");
    assert.equal(at("src/staged new.ts"), "A");
    assert.equal(at("src/deep/inner/untracked.ts"), "?");
    assert.equal(at("src/gone.ts"), "D");
    assert.equal(at("src/new name.ts"), "M");
    assert.equal(at("src/old name.ts"), undefined);
    assert.equal(at("top.txt"), undefined);

    assert.ok(dirtyDirs.has(path.join(root, "src")));
    assert.ok(dirtyDirs.has(path.join(root, "src/deep")));
    assert.ok(dirtyDirs.has(path.join(root, "src/deep/inner")));
    assert.ok(!dirtyDirs.has(path.join(root, "clean")));
    assert.ok(!dirtyDirs.has(root), "the listed folder itself is not marked");
  });

  test("a subfolder gets paths under it, keyed from that folder", async () => {
    const root = repo();
    const sub = path.join(root, "src", "deep");
    const { files, dirtyDirs } = await gitBadges(sub);
    assert.deepEqual(
      [...files.entries()],
      [[path.join(sub, "inner/untracked.ts"), "?"]]
    );
    assert.deepEqual([...dirtyDirs], [path.join(sub, "inner")]);
  });

  test("a folder with only a deleted file is still dirty", async () => {
    const root = repo();
    fs.rmSync(path.join(root, "clean/x.ts"));
    const { dirtyDirs } = await gitBadges(root);
    assert.ok(dirtyDirs.has(path.join(root, "clean")));
  });

  test("cached for a moment: a second call within it sees the same", async () => {
    const root = repo();
    await gitBadges(root);
    write(root, "top.txt", "changed\n");
    const again = await gitBadges(root);
    assert.equal(again.files.get(path.join(root, "top.txt")), undefined);
    clearGitBadgesCache();
    const fresh = await gitBadges(root);
    assert.equal(fresh.files.get(path.join(root, "top.txt")), "M");
  });

  test("outside git: nothing", async () => {
    const dir = tmpDir("nogit");
    dirs.push(dir);
    write(dir, "a.txt", "a\n");
    const { files, dirtyDirs } = await gitBadges(dir);
    assert.equal(files.size, 0);
    assert.equal(dirtyDirs.size, 0);
  });
});
