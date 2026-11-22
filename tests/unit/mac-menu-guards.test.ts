import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parsePermissionPrompt,
  promptFingerprint,
  type PermissionPrompt,
} from "../../lib/permission-prompt";
import {
  askLabelsMatch,
  promptBlocksReply,
  staleAnswer,
} from "../../lib/session-guards";

// lib/db reads DB_PATH when it loads, so the env is set before the import.
// Nothing here types into tmux: every request is answered before it would
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mac-guards-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
process.env.AGENTOS_DISABLE_PUSH = "1";

let db: typeof import("../../lib/db");
let prompt: typeof import("../../app/api/sessions/[id]/prompt/route");
let build: typeof import("../../app/api/build/route");

before(async () => {
  db = await import("../../lib/db");
  prompt = await import("../../app/api/sessions/[id]/prompt/route");
  build = await import("../../app/api/build/route");
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sample = (over: Partial<PermissionPrompt> = {}): PermissionPrompt => ({
  title: "Bash command",
  description: "Create empty file",
  detail: "touch inbox-test.txt",
  question: "Do you want to proceed?",
  options: [
    { index: 0, label: "Yes", kind: "allow" },
    { index: 1, label: "Yes, and don't ask again", kind: "always" },
    { index: 2, label: "No", kind: "deny" },
  ],
  selected: 0,
  ...over,
});

test("promptFingerprint: stable, 16 hex, and follows the detail and labels", () => {
  const fp = promptFingerprint(sample());
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(promptFingerprint(sample()), fp);
  assert.notEqual(promptFingerprint(sample({ detail: "rm -rf x" })), fp);
  const options = sample().options.map((o) =>
    o.index === 2 ? { ...o, label: "No, tell Claude" } : o
  );
  assert.notEqual(promptFingerprint(sample({ options })), fp);
  assert.equal(promptFingerprint(sample({ selected: 2 })), fp);
});

test("staleAnswer: refuses anything that isn't the prompt on screen", () => {
  const p = sample();
  const fp = promptFingerprint(p);
  assert.equal(
    staleAnswer(p, { index: 0, label: "Yes", fingerprint: fp }),
    false
  );
  assert.equal(
    staleAnswer(p, { index: 0, label: "Yes", fingerprint: "0".repeat(16) }),
    true
  );
  assert.equal(staleAnswer(p, { index: 0, label: "Yes" }), false);
  assert.equal(staleAnswer(p, { index: 0, label: "No" }), true);
  assert.equal(staleAnswer(p, { index: 7, label: "Yes" }), true);
  assert.equal(staleAnswer(null, { index: 0, label: "Yes" }), true);
});

test("promptBlocksReply: only when asked to and a prompt is up", () => {
  assert.equal(promptBlocksReply(true, sample()), true);
  assert.equal(promptBlocksReply(true, null), false);
  assert.equal(promptBlocksReply(undefined, sample()), false);
  assert.equal(promptBlocksReply(false, sample()), false);
});

test("askLabelsMatch: old clients match; labels must be the same ones", () => {
  const screen = [{ options: [{ label: "Red" }, { label: "Blue" }] }];
  assert.equal(askLabelsMatch(screen, undefined), true);
  assert.equal(askLabelsMatch(screen, [["Red", "Blue"]]), true);
  assert.equal(askLabelsMatch(screen, [["Red", "Green"]]), false);
  assert.equal(askLabelsMatch(screen, [["Red"]]), false);
  assert.equal(askLabelsMatch(screen, [["Red", "Blue"], ["Yes"]]), false);
  assert.equal(askLabelsMatch([], [["Red", "Blue"]]), false);
});

test("POST /prompt with a fingerprint, tmux not running: 409, nothing typed", async () => {
  db.getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, agent_type)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      "guard-1",
      "guard-1",
      "agentos-unit-no-such-session-guard-1",
      tmp,
      "claude"
    );
  const res = await prompt.POST(
    new Request("http://127.0.0.1:3011/api/sessions/guard-1/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        index: 0,
        label: "Yes",
        fingerprint: "0123456789abcdef",
      }),
    }) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ id: "guard-1" }) }
  );
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "Session not running");
});

test("GET /api/build lists the three features", async () => {
  const res = await build.GET(new Request("http://127.0.0.1:3011/api/build"));
  const body = await res.json();
  for (const f of ["promptFingerprint", "replyGuard", "askLabels"]) {
    assert.ok(body.features.includes(f), f);
  }
});

// The Mac app's menu and notifications show `description` as what will run:
// current Claude Code draws no dashed block around a Bash command, so the
// command lands in description and detail is empty (mac/Tests/main.swift
// builds its prompts in this shape)
test("a current Bash prompt puts the command in description", () => {
  const lines = fs
    .readFileSync(
      path.join(__dirname, "fixtures", "screens", "claude-permission.ansi"),
      "utf8"
    )
    .replace(/\n$/, "")
    .split("\n");
  const p = parsePermissionPrompt(lines, 120);
  assert.ok(p);
  assert.equal(p.title, "Bash command");
  assert.equal(p.detail, "");
  assert.equal(p.description, "touch e2e-perm.txt\nCreate an empty file");
  assert.equal(p.question, "Do you want to proceed?");
});
