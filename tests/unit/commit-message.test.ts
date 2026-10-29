import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCommitPrompt,
  cleanCommitMessage,
  collectCommitContext,
  generateCommitMessage,
  NothingToDescribeError,
} from "../../lib/commit-message";
import { g, tmpDir, userState, write } from "./turns-fixture";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function repo() {
  const root = tmpDir("commit-msg");
  dirs.push(root);
  g(root, "init", "-q", "-b", "main");
  g(root, "config", "user.email", "test@example.com");
  g(root, "config", "user.name", "Test");
  g(root, "config", "commit.gpgsign", "false");
  write(root, "a.txt", "alpha\n");
  write(root, "b.txt", "bravo\n");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "init");
  return root;
}

test("cleanCommitMessage: a plain subject stays as it is", () => {
  assert.equal(
    cleanCommitMessage("Add the branch card\n"),
    "Add the branch card"
  );
});

test("cleanCommitMessage: drops fences, preambles, labels, quotes and the trailing period", () => {
  assert.equal(
    cleanCommitMessage(
      "Here's a commit message:\n\n```\nFix the pull button.\n\nIt pulled twice.\n```"
    ),
    "Fix the pull button\n\nIt pulled twice."
  );
  assert.equal(
    cleanCommitMessage('Commit message: "Move the PR card up."'),
    "Move the PR card up"
  );
  assert.equal(cleanCommitMessage("   \n  "), "");
});

test("cleanCommitMessage: a long subject is cut at a word, within 72", () => {
  const long =
    "Add a much longer subject line than anybody should ever write for a commit in this repository";
  const subject = cleanCommitMessage(long);
  assert.ok(subject.length <= 72, subject);
  assert.ok(long.startsWith(subject));
  assert.doesNotMatch(subject, /\s$/);
});

test("cleanCommitMessage: keeps the body after a blank line", () => {
  assert.equal(
    cleanCommitMessage("Add pull\n\nFast-forward only.\nNever merges."),
    "Add pull\n\nFast-forward only.\nNever merges."
  );
});

test("buildCommitPrompt: rules, files, new files and the diff", () => {
  const prompt = buildCommitPrompt({
    staged: false,
    stat: " a.txt | 2 +-",
    diff: "diff --git a/a.txt b/a.txt\n-alpha\n+alpha two",
    untracked: ["new.ts"],
  });
  assert.match(prompt, /at most 72 characters/);
  assert.match(prompt, /imperative/);
  assert.match(prompt, /Files changed:\n a\.txt \| 2 \+-/);
  assert.match(prompt, /New files:\n- new\.ts/);
  assert.match(prompt, /\+alpha two/);
});

test("collectCommitContext: the staged changes when there are any", async () => {
  const root = repo();
  write(root, "a.txt", "alpha staged\n");
  g(root, "add", "a.txt");
  write(root, "b.txt", "bravo unstaged\n");
  write(root, "c.txt", "new\n");
  const before = userState(root);

  const ctx = await collectCommitContext(root);
  assert.equal(ctx?.staged, true);
  assert.match(ctx!.diff, /\+alpha staged/);
  assert.doesNotMatch(ctx!.diff, /bravo unstaged/);
  assert.deepEqual(ctx!.untracked, []);
  // Reading never touches the user's index
  assert.deepEqual(userState(root), before);
});

test("collectCommitContext: everything, untracked by name, when nothing is staged", async () => {
  const root = repo();
  write(root, "b.txt", "bravo unstaged\n");
  write(root, "dir/c.txt", "new\n");
  const ctx = await collectCommitContext(root);
  assert.equal(ctx?.staged, false);
  assert.match(ctx!.diff, /\+bravo unstaged/);
  assert.deepEqual(ctx!.untracked, ["dir/c.txt"]);

  const onlyNew = repo();
  write(onlyNew, "n.txt", "n\n");
  const ctx2 = await collectCommitContext(onlyNew);
  assert.equal(ctx2?.diff, "");
  assert.deepEqual(ctx2?.untracked, ["n.txt"]);
});

test("collectCommitContext: caps a big diff", async () => {
  const root = repo();
  write(root, "a.txt", "x".repeat(50) + "\n".repeat(1) + "line\n".repeat(5000));
  const ctx = await collectCommitContext(root);
  assert.ok(ctx!.diff.length < 13_000, String(ctx!.diff.length));
  assert.match(ctx!.diff, /diff cut short/);
});

test("generateCommitMessage: nothing to describe throws NothingToDescribeError", async () => {
  const root = repo();
  await assert.rejects(
    generateCommitMessage(root, async () => "unused"),
    NothingToDescribeError
  );
});

test("generateCommitMessage: the runner gets the prompt and its reply is cleaned", async () => {
  const root = repo();
  write(root, "a.txt", "alpha two\n");
  let seen = "";
  const message = await generateCommitMessage(root, async (cwd, prompt) => {
    assert.equal(cwd, root);
    seen = prompt;
    return "```\nUpdate alpha.\n```\n";
  });
  assert.equal(message, "Update alpha");
  assert.match(seen, /\+alpha two/);

  await assert.rejects(
    generateCommitMessage(root, async () => {
      throw new Error("CLI failed");
    }),
    /CLI failed/
  );
  await assert.rejects(
    generateCommitMessage(root, async () => "  "),
    /empty/
  );
});
