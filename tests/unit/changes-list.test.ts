import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changedFiles,
  commitLabel,
  commitPlan,
  selectedPath,
  splitPath,
  totals,
} from "../../components/Changes/changes-list";
import type { GitFile } from "../../lib/git-status";

const f = (
  path: string,
  staged: boolean,
  additions?: number,
  deletions?: number
): GitFile => ({
  path,
  status: staged ? "added" : "modified",
  staged,
  additions,
  deletions,
});

test("splitPath: name and folder", () => {
  assert.deepEqual(splitPath("components/Session/ActivityStrip.tsx"), {
    name: "ActivityStrip.tsx",
    folder: "components/Session",
  });
  assert.deepEqual(splitPath("README.md"), { name: "README.md", folder: "" });
});

test("changedFiles: one row per path, counts added up", () => {
  const files = changedFiles({
    staged: [f("a.ts", true, 3, 1)],
    unstaged: [f("a.ts", false, 2, 2), f("lib/b.ts", false, 5, 0)],
    untracked: [{ path: "new.md", status: "untracked", staged: false }],
  });
  assert.deepEqual(
    files.map((x) => [x.path, x.additions, x.deletions]),
    [
      ["a.ts", 5, 3],
      ["lib/b.ts", 5, 0],
      ["new.md", undefined, undefined],
    ]
  );
  assert.equal(files[0].staged && files[0].unstaged, true);
  assert.equal(files[2].untracked, true);
  assert.deepEqual(totals(files), { additions: 10, deletions: 3 });
});

test("selectedPath: the pick while listed, else the first", () => {
  const files = changedFiles({
    staged: [],
    unstaged: [f("a.ts", false), f("b.ts", false)],
    untracked: [],
  });
  assert.equal(selectedPath(files, null), "a.ts");
  assert.equal(selectedPath(files, "b.ts"), "b.ts");
  assert.equal(selectedPath(files, "gone.ts"), "a.ts");
  assert.equal(selectedPath([], "a.ts"), null);
});

test("commitPlan: staged only when something is, else every file", () => {
  const none = changedFiles({
    staged: [],
    unstaged: [f("a.ts", false)],
    untracked: [{ path: "n.md", status: "untracked", staged: false }],
  });
  assert.deepEqual(commitPlan(none), { count: 2, stage: ["a.ts", "n.md"] });
  const some = changedFiles({
    staged: [f("a.ts", true)],
    unstaged: [f("b.ts", false)],
    untracked: [],
  });
  assert.deepEqual(commitPlan(some), { count: 1, stage: [] });
  assert.equal(commitLabel(1), "Commit 1 file");
  assert.equal(commitLabel(2), "Commit 2 files");
});
