import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  pullFastForward,
  pullSummary,
  refusalMessage,
} from "../../lib/git-pull";
import { g, read, tmpDir, userState, write } from "./turns-fixture";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function identity(repo: string) {
  g(repo, "config", "user.email", "test@example.com");
  g(repo, "config", "user.name", "Test");
  g(repo, "config", "commit.gpgsign", "false");
}

function commit(repo: string, file: string, text: string) {
  write(repo, file, text);
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", `Edit ${file}`);
}

/** Two clones of one bare remote: `other` pushes, `repo` pulls */
function pair() {
  const remote = tmpDir("pull-remote");
  const repo = tmpDir("pull-repo");
  const other = tmpDir("pull-other");
  dirs.push(remote, repo, other);
  g(remote, "init", "-q", "--bare", "-b", "main");
  g(other, "init", "-q", "-b", "main");
  identity(other);
  commit(other, "a.txt", "alpha\n");
  g(other, "remote", "add", "origin", remote);
  g(other, "push", "-q", "-u", "origin", "main");
  g(repo, "clone", "-q", remote, ".");
  identity(repo);
  return { repo, other };
}

test("pullFastForward: fast-forwards from the upstream", async () => {
  const { repo, other } = pair();
  commit(other, "b.txt", "bravo\n");
  g(other, "push", "-q");

  const result = await pullFastForward(repo);
  assert.equal(result.ok, true);
  assert.match(result.ok ? result.output : "", /1 file changed/);
  assert.equal(read(repo, "b.txt"), "bravo\n");
  assert.equal(
    g(repo, "rev-parse", "HEAD").trim(),
    g(other, "rev-parse", "HEAD").trim()
  );

  const again = await pullFastForward(repo);
  assert.deepEqual(again, { ok: true, output: "Already up to date." });
});

test("pullFastForward: refuses a pull that would need a merge, touching nothing", async () => {
  const { repo, other } = pair();
  commit(other, "b.txt", "bravo\n");
  g(other, "push", "-q");
  commit(repo, "c.txt", "charlie\n");
  write(repo, "a.txt", "alpha staged\n");
  g(repo, "add", "a.txt");
  write(repo, "u.txt", "untracked\n");
  const before = userState(repo);

  const result = await pullFastForward(repo);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "refused");
  assert.match(!result.ok ? result.message : "", /fast-forward/i);
  assert.doesNotMatch(!result.ok ? result.message : "", /^hint/);
  assert.deepEqual(userState(repo), before);
});

test("pullFastForward: refuses when local changes would be overwritten, and keeps them", async () => {
  const { repo, other } = pair();
  commit(other, "a.txt", "alpha from origin\n");
  g(other, "push", "-q");
  write(repo, "a.txt", "alpha local edit\n");
  const before = userState(repo);

  const result = await pullFastForward(repo);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "refused");
  assert.equal(read(repo, "a.txt"), "alpha local edit\n");
  assert.deepEqual(userState(repo), before);
});

test("pullFastForward: a branch without an upstream says so", async () => {
  const { repo } = pair();
  g(repo, "checkout", "-q", "-b", "local-only");
  const result = await pullFastForward(repo);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "no-upstream");
});

test("pullSummary and refusalMessage: git's line a person reads", () => {
  assert.equal(
    pullSummary(
      "Updating 1a2b..3c4d\nFast-forward\n b.txt | 1 +\n 1 file changed, 1 insertion(+)\n create mode 100644 b.txt\n"
    ),
    "1 file changed, 1 insertion(+)"
  );
  assert.equal(pullSummary("Already up to date.\n"), "Already up to date.");
  assert.equal(pullSummary(""), "");
  assert.equal(
    refusalMessage(
      "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint:\nfatal: Not possible to fast-forward, aborting.\n"
    ),
    "Not possible to fast-forward, aborting."
  );
  assert.equal(
    refusalMessage(
      "error: Your local changes to the following files would be overwritten by merge:\n\ta.txt\nPlease commit your changes or stash them before you merge.\nAborting\n"
    ),
    "Your local changes to the following files would be overwritten by merge:"
  );
});
