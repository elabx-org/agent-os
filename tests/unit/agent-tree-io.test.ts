import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  conversationDetail,
  shownPath,
  COUNT_LIMIT,
} from "../../lib/claude-subagents";
import {
  ownTask,
  readAgentLog,
  resetAgentLogCache,
} from "../../lib/agent-tree-log";
import {
  mentionedIds,
  offsetBefore,
  resetMentionCache,
} from "../../lib/agent-tree-links";
import { readActivities } from "../../lib/agent-tree";

const lines = (...entries: unknown[]) =>
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agentos-io-"));

const user = (text: string, at = "2026-10-29T10:00:00Z") => ({
  type: "user",
  timestamp: at,
  message: { role: "user", content: text },
});

test("ownTask drops the opening shared with the most alike sibling", () => {
  const opening = "You are designing mock screens for Agent-OS.\nRules.\n";
  const mine = opening + "Your group: tree. Make N-Tree and O-Tree.";
  const designer = opening + "Your group: undo. Make N-Undo.";
  const critic = "You are a strict design critic.\nCheck the mocks.";
  assert.equal(
    ownTask(mine, [designer, critic]),
    "Your group: tree. Make N-Tree and O-Tree."
  );
  // Nothing shared, or alone: the whole prompt
  assert.equal(ownTask(mine, [critic]), mine);
  assert.equal(ownTask(mine, []), mine);
  // Too little left: the whole prompt
  assert.equal(ownTask(opening + "Go.", [opening + "Run."]), opening + "Go.");
});

test("a workflow agent's detail shows only its own task", async () => {
  resetAgentLogCache();
  const run = path.join(tmp(), "subagents", "workflows", "wf_1");
  fs.mkdirSync(run, { recursive: true });
  const opening = "You are designing mock screens.\nShared rules here.\n";
  fs.writeFileSync(
    path.join(run, "agent-aone.jsonl"),
    lines(user(opening + "Your group: tree. Make the tree mocks."))
  );
  fs.writeFileSync(
    path.join(run, "agent-atwo.jsonl"),
    lines(user(opening + "Your group: undo. Make the undo mocks."))
  );
  const d = await conversationDetail(
    path.join(run, "agent-aone.jsonl"),
    "aone"
  );
  assert.equal(d?.prompt, "Your group: tree. Make the tree mocks.");
});

test("shownPath: inside the session, its repository, else ~", () => {
  const repo = tmp();
  fs.mkdirSync(path.join(repo, ".git"));
  fs.mkdirSync(path.join(repo, "app"));
  const cwd = path.join(repo, "app");
  assert.equal(shownPath([cwd], path.join(cwd, "a.ts")), "a.ts");
  assert.equal(
    shownPath([cwd], path.join(repo, ".mock", "N.html")),
    ".mock/N.html"
  );
  const home = os.homedir();
  assert.equal(
    shownPath(["/nowhere"], path.join(home, "x", "y.ts")),
    "~/x/y.ts"
  );
});

test("readAgentLog yields between chunks and shares one read", async () => {
  resetAgentLogCache();
  const file = path.join(tmp(), "agent-big.jsonl");
  // ~12MB: three chunks
  const pad = "x".repeat(4000);
  const fd = fs.openSync(file, "w");
  for (let i = 0; i < 3000; i++)
    fs.writeSync(fd, JSON.stringify({ type: "progress", pad }) + "\n");
  fs.writeSync(fd, lines(user("Do the thing")));
  fs.closeSync(fd);

  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  const [a, b] = await Promise.all([readAgentLog(file), readAgentLog(file)]);
  clearInterval(timer);
  assert.equal(a, b);
  assert.equal(a?.prompt, "Do the thing");
  assert.ok(ticks > 0, "the loop never ran during the read");
});

test("readActivities skips big finished agents but keeps their times", async () => {
  resetAgentLogCache();
  const transcript = path.join(tmp(), "t.jsonl");
  fs.writeFileSync(transcript, "");
  const dir = path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent-asmall.jsonl"), lines(user("Hi")));
  const big = path.join(dir, "agent-abig.jsonl");
  fs.writeFileSync(big, lines(user("Big")));
  fs.truncateSync(big, COUNT_LIMIT + 1);
  const out = await readActivities(transcript, [
    { agentId: "asmall", running: false },
    { agentId: "abig", running: false },
  ]);
  assert.equal(out.asmall.startedAt, "2026-10-29T10:00:00Z");
  assert.equal(out.abig.steps, 0);
  assert.ok(out.abig.updatedAt);
});

test("mentions are searched from about the agent's start, not byte 0", async () => {
  resetMentionCache();
  const file = path.join(tmp(), "t.jsonl");
  const early = Array.from({ length: 400 }, (_, i) =>
    user(
      `old ${i} ${"y".repeat(400)} ${i < 100 ? "ffff6666" : ""}`,
      `2026-10-29T08:${String(i % 60).padStart(2, "0")}:00Z`
    )
  );
  fs.writeFileSync(
    file,
    lines(
      ...early,
      user("Started background agent aaaa1111", "2026-10-29T12:00:00Z")
    )
  );
  const size = fs.statSync(file).size;
  const at = await offsetBefore(file, size, Date.parse("2026-10-29T11:00:00Z"));
  assert.ok(at > size / 2, `searched from ${at} of ${size}`);
  const started = Date.parse("2026-10-29T12:00:00Z");
  const found = await mentionedIds(file, [
    { id: "aaaa1111", startedAt: started },
    // Named only long before it started: not its output
    { id: "ffff6666", startedAt: started },
  ]);
  assert.deepEqual([...found], ["aaaa1111"]);
});
