import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDirFor, transcriptFileFor } from "../../lib/claude-transcript";
import {
  expandHome,
  locateTranscript,
  sessionCwd,
} from "../../lib/transcript-locate";
import type { Session } from "../../lib/db/types";

const ID = "0f6c2b3a-1d2e-4f50-8a9b-0c1d2e3f4a5b";
let root = "";
const saved = { ...process.env };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-locate-"));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
  // No tmux server of ours: the pane lookups find nothing
  delete process.env.TMUX;
  delete process.env.TMUX_PANE;
  process.env.TMUX_TMPDIR = path.join(root, "tmux");
  fs.mkdirSync(process.env.TMUX_TMPDIR);
});

after(() => {
  process.env = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s-" + Math.random().toString(36).slice(2),
    name: "fixture",
    tmux_name: "",
    agent_type: "claude",
    working_directory: "/tmp/agentos-m4-none",
    worktree_path: null,
    claude_session_id: ID,
    paused_at: null,
    ...over,
  } as Session;
}

function write(dir: string, id = ID): string {
  const folder = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", dir);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${id}.jsonl`);
  fs.writeFileSync(file, "{}\n");
  return file;
}

test("projectDirFor turns every non-alphanumeric into -", () => {
  assert.equal(
    projectDirFor("/config/workspace/gh/agent-os"),
    "-config-workspace-gh-agent-os"
  );
  assert.equal(projectDirFor("/home/me/my.app"), "-home-me-my-app");
  assert.equal(projectDirFor("/srv/snake_case dir"), "-srv-snake-case-dir");
  assert.equal(projectDirFor("/a/.agent-os/wt/x"), "-a--agent-os-wt-x");
});

test("expandHome and sessionCwd: worktree first, ~ expanded", () => {
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/x"), path.join(os.homedir(), "x"));
  assert.equal(expandHome("/abs"), "/abs");
  assert.equal(
    sessionCwd({ worktree_path: "/w", working_directory: "/d" }),
    "/w"
  );
  assert.equal(
    sessionCwd({ worktree_path: null, working_directory: "~/d" }),
    path.join(os.homedir(), "d")
  );
});

test("finds the transcript by claude_session_id with no pane", async () => {
  const cwd = "/tmp/agentos-m4/my.repo_1";
  const file = write(projectDirFor(cwd));
  const found = await locateTranscript(session({ working_directory: cwd }));
  assert.deepEqual(found, { sessionId: ID, file, cwd });
});

test("a paused session is found the same way", async () => {
  const cwd = "/tmp/agentos-m4/paused";
  const file = write(projectDirFor(cwd));
  const found = await locateTranscript(
    session({ working_directory: cwd, paused_at: Date.now() })
  );
  assert.equal(found?.file, file);
});

test("falls back to scanning the project folders for the id", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const file = write("-some-older-encoding", id);
  assert.equal(transcriptFileFor(id, "/elsewhere"), file);
  const found = await locateTranscript(
    session({ claude_session_id: id, working_directory: "/elsewhere" })
  );
  assert.equal(found?.file, file);
});

test("file null when not written yet; null without an id or for others", async () => {
  const id = "99999999-2222-4333-8444-555555555555";
  const found = await locateTranscript(session({ claude_session_id: id }));
  assert.deepEqual(found, {
    sessionId: id,
    file: null,
    cwd: "/tmp/agentos-m4-none",
  });
  assert.equal(
    await locateTranscript(session({ claude_session_id: null })),
    null
  );
  assert.equal(
    await locateTranscript(session({ claude_session_id: "../../etc" })),
    null
  );
  assert.equal(
    await locateTranscript(
      session({ agent_type: "codex" } as Partial<Session>)
    ),
    null
  );
});

test("no projects folder at all: null file, no throw", async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(root, "missing");
  try {
    assert.equal(transcriptFileFor(ID, "/x"), null);
  } finally {
    process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
