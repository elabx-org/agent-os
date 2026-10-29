import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDirFor, type ChatItem } from "../../lib/claude-transcript";
import {
  MAX_SUMMARY_CHARS,
  buildSummary,
  cleanScrollback,
  estimateTokens,
  extractConversation,
  formatHandoff,
  parsePorcelain,
} from "../../lib/summarize";
import type { Session } from "../../lib/db/types";

const ID = "0f6c2b3a-1d2e-4f50-8a9b-0c1d2e3f4a5b";
const FIXTURE = path.join(__dirname, "fixtures", "m4", "transcript.jsonl");
let root = "";
let repo = "";
const saved = { ...process.env };

function git(...args: string[]) {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-summary-"));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
  delete process.env.TMUX;
  delete process.env.TMUX_PANE;
  process.env.TMUX_TMPDIR = path.join(root, "tmux");
  fs.mkdirSync(process.env.TMUX_TMPDIR);

  repo = path.join(root, "my.repo");
  fs.mkdirSync(repo);
  git("init", "-q", "-b", "feature/dark");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.ts"), "a\n");
  fs.writeFileSync(path.join(repo, "b.ts"), "b\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(repo, "a.ts"), "changed\n");
  fs.writeFileSync(path.join(repo, "new file.ts"), "n\n");
  git("mv", "b.ts", "c.ts");

  const folder = path.join(
    process.env.CLAUDE_CONFIG_DIR,
    "projects",
    projectDirFor(repo)
  );
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(folder, `${ID}.jsonl`));
});

after(() => {
  process.env = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s-" + Math.random().toString(36).slice(2),
    name: "dark mode",
    tmux_name: "",
    agent_type: "claude",
    working_directory: repo,
    worktree_path: null,
    branch_name: null,
    claude_session_id: ID,
    paused_at: Date.now(),
    ...over,
  } as Session;
}

const item = (kind: "user" | "assistant", text: string): ChatItem => ({
  kind,
  id: Math.random().toString(),
  text,
  ts: "",
});

test("parsePorcelain reads -z output, renames skip their source", () => {
  assert.deepEqual(parsePorcelain(" M a.ts\0R  c.ts\0b.ts\0?? new file.ts\0"), [
    { code: " M", path: "a.ts" },
    { code: "R ", path: "c.ts" },
    { code: "??", path: "new file.ts" },
  ]);
  assert.deepEqual(parsePorcelain(""), []);
});

test("extractConversation: last asks, final replies, slash commands out", () => {
  const out = extractConversation([
    item("user", "one"),
    item("assistant", "thinking"),
    item("assistant", "done one"),
    item("user", "/model sonnet"),
    item("user", "two"),
    item("assistant", "done two"),
    item("user", "three"),
    item("user", "four"),
    item("assistant", "done four"),
  ]);
  assert.deepEqual(out.asks, ["two", "three", "four"]);
  assert.deepEqual(out.conclusions, ["done two", "done four"]);
  assert.equal(out.compacted, null);
  assert.equal(out.plan, null);
});

test("extractConversation keeps a compaction summary nothing followed", () => {
  const out = extractConversation([
    item("user", "old"),
    { kind: "summary", id: "x", text: "Built the thing.", ts: "" },
  ]);
  assert.deepEqual(out.asks, []);
  assert.equal(out.compacted, "Built the thing.");
});

test("formatHandoff is self-contained and capped", () => {
  const text = formatHandoff({
    agentType: "codex",
    name: "big",
    cwd: "/r",
    branch: "main",
    asks: ["x".repeat(600)],
    conclusions: ["y".repeat(1500), "z".repeat(1500)],
    body: { title: "Earlier", text: "w".repeat(5000) },
    files: Array.from({ length: 60 }, (_, i) => ({
      code: " M",
      path: `f${i}`,
    })),
    plan: null,
  });
  assert.ok(text.startsWith('# Handoff from Codex session "big"'));
  assert.ok(text.includes("Folder: /r (branch main)"));
  assert.ok(text.length <= MAX_SUMMARY_CHARS, String(text.length));
  assert.ok(text.endsWith("carry on from where it got to."));
});

test("cleanScrollback strips escapes, folds blanks, keeps the end", () => {
  assert.equal(
    cleanScrollback("\x1b[1mhi\x1b[0m  \n\n\n\nthere\n\n"),
    "hi\n\nthere"
  );
  const long = cleanScrollback("a".repeat(50) + "END", 10);
  assert.equal(long, "…aaaaaaEND");
});

test("buildSummary from a paused session's transcript (no pane)", async () => {
  const summary = await buildSummary(session());
  assert.equal(summary.source, "transcript");
  assert.deepEqual(summary.plan, { done: 3, total: 5 });
  assert.deepEqual(summary.filesChanged.sort(), [
    "a.ts",
    "c.ts",
    "new file.ts",
  ]);
  assert.equal(summary.tokens, estimateTokens(summary.text));

  const t = summary.text;
  assert.ok(t.startsWith('# Handoff from Claude session "dark mode"'));
  assert.ok(t.includes(`Folder: ${repo} (branch feature/dark)`));
  assert.ok(t.includes("- Add a dark mode toggle to the settings page"));
  assert.ok(t.includes("- Now persist the choice in localStorage"));
  assert.ok(!t.includes("/model"));
  assert.ok(!t.includes("Sidechain"));
  assert.ok(t.includes('saved in lib/theme.ts under the key "theme"'));
  assert.ok(t.includes("## Open plan (3 of 5 done)"));
  assert.ok(t.includes("- [>] Test"));
  assert.ok(t.includes("- [ ] Docs"));
  assert.ok(t.includes("- ?? new file.ts"));
});

test("buildSummary never throws: no transcript, no pane, no git", async () => {
  const summary = await buildSummary(
    session({
      claude_session_id: null,
      working_directory: path.join(root, "nowhere"),
    })
  );
  assert.equal(summary.source, "scrollback");
  assert.deepEqual(summary.filesChanged, []);
  assert.equal(summary.plan, null);
  assert.ok(summary.text.includes("No transcript or terminal history"));
});

test("buildSummary for a non-Claude agent without its pane", async () => {
  const summary = await buildSummary(
    session({ agent_type: "codex" } as Partial<Session>)
  );
  assert.equal(summary.source, "scrollback");
  assert.ok(
    summary.text.startsWith('# Handoff from Codex session "dark mode"')
  );
  assert.equal(summary.filesChanged.length, 3);
});
