import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-hardening-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

import { checkoutBranch, createBranch } from "../../lib/git-status";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function repo(): string {
  const dir = fs.mkdtempSync(path.join(tmp, "repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git(
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "x"
  );
  return dir;
}

test("git: a branch name is never run as a command", () => {
  const dir = repo();
  const marker = path.join(dir, "pwned");
  const name = `";touch ${marker};"`;
  assert.throws(() => createBranch(dir, name));
  assert.throws(() => checkoutBranch(dir, name));
  assert.throws(() => checkoutBranch(dir, `$(touch ${marker})`));
  assert.throws(() => createBranch(dir, "--orphan"));
  assert.equal(fs.existsSync(marker), false);
  createBranch(dir, "feature/ok");
  checkoutBranch(dir, "main");
});

test("preview: a session that isn't here is 404, and its id is never run", async () => {
  const { GET } = await import("../../app/api/sessions/[id]/preview/route");
  const marker = path.join(tmp, "pwned-preview");
  const id = `x";touch ${marker};"`;
  const res = await GET(
    new Request(
      "http://127.0.0.1:3011/"
    ) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ id }) }
  );
  assert.equal(res.status, 404);
  assert.equal(fs.existsSync(marker), false);
});
