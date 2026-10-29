import { test } from "node:test";
import assert from "node:assert/strict";
import { gitBadgeClass, gitBadgeOf } from "../../lib/git-types";

test("gitBadgeOf: one letter per git status", () => {
  assert.equal(gitBadgeOf("modified"), "M");
  assert.equal(gitBadgeOf("renamed"), "M");
  assert.equal(gitBadgeOf("unmerged"), "M");
  assert.equal(gitBadgeOf("added"), "A");
  assert.equal(gitBadgeOf("copied"), "A");
  assert.equal(gitBadgeOf("deleted"), "D");
  assert.equal(gitBadgeOf("untracked"), "?");
});

test("gitBadgeClass: the letter's colour", () => {
  assert.deepEqual((["M", "A", "D", "?"] as const).map(gitBadgeClass), [
    "git-m",
    "git-a",
    "git-d",
    "git-u",
  ]);
});
