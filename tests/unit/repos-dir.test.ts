import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expandReposDir,
  normalizeReposDir,
  tildePath,
} from "../../lib/repos-dir";

test("normalizeReposDir: full paths only, tidied", () => {
  assert.equal(normalizeReposDir("~/code/"), "~/code");
  assert.equal(normalizeReposDir(" /srv/code "), "/srv/code");
  assert.equal(normalizeReposDir("~"), "~");
  for (const bad of ["", "/", "code", "~user/code", "~/a/../b", "/a\nb", 3]) {
    assert.equal(normalizeReposDir(bad), null, String(bad));
  }
});

test("expandReposDir and tildePath are each other's inverse at home", () => {
  assert.equal(expandReposDir("~/code", "/Users/me"), "/Users/me/code");
  assert.equal(expandReposDir("~", "/Users/me"), "/Users/me");
  assert.equal(expandReposDir("/srv/code", "/Users/me"), "/srv/code");
  assert.equal(tildePath("/Users/me/code/app", "/Users/me"), "~/code/app");
  assert.equal(tildePath("/config/workspace/gh", "/config"), "~/workspace/gh");
  assert.equal(tildePath("/srv/code", "/config"), "/srv/code");
});

test("isAgentOSWorktree: a marked .sessions folder's children count", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { isAgentOSWorktree } = await import("../../lib/worktrees");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "repos-"));
  const sessions = path.join(base, ".sessions");
  fs.mkdirSync(path.join(sessions, "app-main-abc123"), { recursive: true });
  fs.mkdirSync(path.join(base, "app"));
  // Unmarked: someone else's folder that happens to share the name
  assert.equal(
    isAgentOSWorktree(path.join(sessions, "app-main-abc123")),
    false
  );
  fs.writeFileSync(path.join(sessions, ".agentos"), "");
  assert.equal(isAgentOSWorktree(path.join(sessions, "app-main-abc123")), true);
  assert.equal(isAgentOSWorktree(path.join(base, "app")), false);
  assert.equal(isAgentOSWorktree(sessions), false);
  fs.rmSync(base, { recursive: true, force: true });
});
