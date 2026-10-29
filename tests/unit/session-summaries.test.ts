import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDirFor } from "../../lib/claude-transcript";
import type { Session } from "../../lib/db/types";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-attach-sum-"));
const saved = { ...process.env };
process.env.DB_PATH = path.join(root, "test.db");
process.env.AGENT_OS_HOME = path.join(root, "home");
process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
// No tmux server of ours: the pane lookups find nothing
delete process.env.TMUX;
delete process.env.TMUX_PANE;
process.env.TMUX_TMPDIR = path.join(root, "tmux");
fs.mkdirSync(process.env.TMUX_TMPDIR);

const ID = "0f6c2b3a-1d2e-4f50-8a9b-0c1d2e3f4a5b";
const FIXTURE = path.join(__dirname, "fixtures", "m4", "transcript.jsonl");
const cwd = path.join(root, "repo");
let transcript = "";

let sums: typeof import("../../lib/session-summaries");
let summarize: typeof import("../../lib/summarize");
let db: typeof import("../../lib/db");

before(async () => {
  fs.mkdirSync(cwd);
  const folder = path.join(
    process.env.CLAUDE_CONFIG_DIR!,
    "projects",
    projectDirFor(cwd)
  );
  fs.mkdirSync(folder, { recursive: true });
  transcript = path.join(folder, `${ID}.jsonl`);

  db = await import("../../lib/db");
  sums = await import("../../lib/session-summaries");
  summarize = await import("../../lib/summarize");
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
  // Summaries are stored only for sessions that still exist
  db.getDb()
    .prepare(`INSERT INTO sessions (id, name) VALUES (?, ?), (?, ?)`)
    .run("s-sum", "Stack health check", "s-none", "None");
});

after(() => {
  process.env = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  fs.copyFileSync(FIXTURE, transcript);
  db.getDb().exec("DELETE FROM session_summaries");
});

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s-sum",
    name: "Stack health check",
    tmux_name: "",
    agent_type: "claude",
    working_directory: cwd,
    worktree_path: null,
    branch_name: null,
    claude_session_id: ID,
    // Paused: the transcript is found without a pane (M4 locator)
    paused_at: Date.now(),
    ...over,
  } as Session;
}

/** As a message that attaches the session asks for it */
const STORE = { persist: true };

const row = (id = "s-sum") =>
  db
    .getDb()
    .prepare(`SELECT * FROM session_summaries WHERE session_id = ?`)
    .get(id) as { basis: string; text: string; tokens: number } | undefined;

test("summaryBasis: the transcript's size and mtime, else a minute", async () => {
  const stat = fs.statSync(transcript);
  assert.equal(
    await sums.summaryBasis(session()),
    `t:${stat.size}:${Math.floor(stat.mtimeMs)}`
  );
  const codex = session({ agent_type: "codex" } as Partial<Session>);
  assert.equal(await sums.summaryBasis(codex, 120_500), "s:2");
  assert.equal(await sums.summaryBasis(codex, 179_999), "s:2");
  assert.equal(await sums.summaryBasis(codex, 180_000), "s:3");
  const lost = session({ claude_session_id: null });
  assert.match(await sums.summaryBasis(lost), /^s:\d+$/);
});

test("builds an attach summary, not a handoff, and stores it", async () => {
  const s = await sums.getSessionSummary(session(), STORE);
  assert.equal(s.source, "transcript");
  assert.equal(s.empty, false);
  assert.ok(s.text.startsWith('# Session "Stack health check" (Claude)'));
  assert.ok(!s.text.includes("Handoff"));
  assert.ok(!s.text.includes("taking over"));
  assert.ok(!s.text.includes("carry on"));
  assert.ok(s.text.includes("- Add a dark mode toggle to the settings page"));
  assert.ok(s.text.endsWith("check git before relying on file contents."));
  assert.equal(s.tokens, summarize.estimateTokens(s.text));
  assert.deepEqual(row(), {
    ...row(),
    basis: s.basis,
    text: s.text,
    tokens: s.tokens,
  });
});

test("the cache holds while the transcript is unchanged", async () => {
  const first = await sums.getSessionSummary(session(), STORE);
  db.getDb()
    .prepare(
      `UPDATE session_summaries SET text = 'CACHED' WHERE session_id = ?`
    )
    .run("s-sum");
  const second = await sums.getSessionSummary(session(), STORE);
  assert.equal(second.text, "CACHED");
  assert.equal(second.basis, first.basis);
  // fresh rebuilds anyway
  const fresh = await sums.getSessionSummary(session(), {
    ...STORE,
    fresh: true,
  });
  assert.notEqual(fresh.text, "CACHED");
});

test("a grown transcript rebuilds the summary", async () => {
  const first = await sums.getSessionSummary(session(), STORE);
  db.getDb()
    .prepare(
      `UPDATE session_summaries SET text = 'CACHED' WHERE session_id = ?`
    )
    .run("s-sum");
  fs.appendFileSync(
    transcript,
    JSON.stringify({
      type: "user",
      uuid: "u-new",
      timestamp: "2026-10-29T11:00:00.000Z",
      cwd,
      message: { role: "user", content: "Check the herald healthcheck too" },
    }) + "\n"
  );
  const next = await sums.getSessionSummary(session(), STORE);
  assert.notEqual(next.basis, first.basis);
  assert.notEqual(next.text, "CACHED");
  assert.ok(next.text.includes("- Check the herald healthcheck too"));
  assert.equal(row()?.basis, next.basis);
});

test("a touched transcript (same size, new mtime) rebuilds too", async () => {
  const first = await sums.getSessionSummary(session(), STORE);
  db.getDb()
    .prepare(
      `UPDATE session_summaries SET text = 'CACHED' WHERE session_id = ?`
    )
    .run("s-sum");
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(transcript, later, later);
  const next = await sums.getSessionSummary(session(), STORE);
  assert.notEqual(next.basis, first.basis);
  assert.notEqual(next.text, "CACHED");
});

test("concurrent requests share one build", async () => {
  const [a, b, c] = await Promise.all([
    sums.getSessionSummary(session(), STORE),
    sums.getSessionSummary(session(), STORE),
    sums.getSessionSummary(session(), { ...STORE, fresh: true }),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test("no transcript and no pane: an empty scrollback summary", async () => {
  const s = await sums.getSessionSummary(
    session({ id: "s-none", claude_session_id: null })
  );
  assert.equal(s.source, "scrollback");
  assert.equal(s.empty, true);
  assert.match(s.basis, /^s:\d+$/);
  assert.ok(s.text.includes("No transcript or terminal history"));
  assert.ok(!s.text.includes("Ask the user"));
});

test("a size for the picker is not stored", async () => {
  const s = await sums.getSessionSummary(session());
  assert.ok(s.tokens > 0);
  assert.equal(row(), undefined);
  // Asked again with the same basis: the same one, still nothing stored
  assert.deepEqual(await sums.getSessionSummary(session()), s);
  assert.equal(row(), undefined);
  // Stored once a message attaches it
  await sums.getSessionSummary(session(), STORE);
  assert.equal(row()?.basis, s.basis);
});

test("a session deleted while its summary was built leaves no row", async () => {
  const s = await sums.getSessionSummary(
    session({ id: "s-gone" } as Partial<Session>),
    STORE
  );
  assert.ok(s.text);
  assert.equal(row("s-gone"), undefined);
});

test("forgetSessionSummary drops the row", async () => {
  await sums.getSessionSummary(session(), STORE);
  assert.ok(row());
  sums.forgetSessionSummary("s-sum");
  assert.equal(row(), undefined);
  sums.forgetSessionSummary("s-sum");
});

test("formatHandoff keeps the handoff wording by default", () => {
  const input = {
    agentType: "claude",
    name: "x",
    cwd: "/r",
    branch: null,
    asks: ["do it"],
    conclusions: [],
    files: [],
    plan: null,
  };
  const handoff = summarize.formatHandoff(input);
  assert.equal(handoff, summarize.formatHandoff(input, "handoff"));
  assert.ok(handoff.startsWith('# Handoff from Claude session "x"'));
  const attach = summarize.formatHandoff(input, "attach");
  assert.equal(
    attach,
    [
      '# Session "x" (Claude)',
      "",
      "Folder: /r",
      "",
      "## What the user asked\n- do it",
      "",
      "Its working tree may have changed since; check git before relying on file contents.",
    ].join("\n")
  );
});
