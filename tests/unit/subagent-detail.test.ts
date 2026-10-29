import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subagentDetail } from "../../lib/claude-subagents";
import {
  commandTarget,
  editDelta,
  harnessTask,
  lineCount,
} from "../../lib/agent-tree-log";

const lines = (...entries: unknown[]) =>
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

const call = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  at: string,
  extra: Record<string, unknown> = {}
) => ({
  type: "assistant",
  timestamp: at,
  ...extra,
  message: {
    model: "claude-sonnet-4-6",
    content: [{ type: "tool_use", id, name, input }],
    usage: {
      input_tokens: 3,
      output_tokens: 40,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 8_000,
    },
  },
});

const result = (id: string, at: string, error = false) => ({
  type: "user",
  timestamp: at,
  message: {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: id, content: "ok", is_error: error },
    ],
  },
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-detail-"));
  const transcript = path.join(dir, "sess.jsonl");
  fs.writeFileSync(transcript, "");
  const subs = path.join(dir, "sess", "subagents");
  fs.mkdirSync(path.join(subs, "workflows", "wf_x"), { recursive: true });
  return { dir, transcript, subs };
}

test("prompt, last four calls oldest first, files written, usage", () => {
  const { transcript, subs } = setup();
  const file = path.join(subs, "workflows", "wf_x", "agent-aundo.jsonl");
  fs.writeFileSync(
    file,
    lines(
      { type: "attachment", attachment: { type: "prompt_snapshot" } },
      {
        type: "user",
        timestamp: "2026-10-29T09:00:00.000Z",
        message: {
          role: "user",
          content: "  Mock undo for a single diff hunk.\n",
        },
      },
      call(
        "r1",
        "Read",
        { file_path: "/repo/.mock/Open-Changes.dc.html" },
        "2026-10-29T09:01:00.000Z"
      ),
      result("r1", "2026-10-29T09:01:01.000Z"),
      call(
        "w1",
        "Write",
        {
          file_path: "/repo/.mock/modern/N-Undo.dc.html",
          content: "a\nb\nc\n",
        },
        "2026-10-29T09:02:00.000Z"
      ),
      result("w1", "2026-10-29T09:02:01.000Z"),
      call(
        "e1",
        "Edit",
        {
          file_path: "/repo/.mock/modern/N-Undo.dc.html",
          old_string: "a\nb",
          new_string: "a\nB\nb2",
        },
        "2026-10-29T09:03:00.000Z"
      ),
      result("e1", "2026-10-29T09:03:01.000Z"),
      // A failed edit writes nothing
      call(
        "e2",
        "Edit",
        {
          file_path: "/repo/ui.css",
          old_string: "x",
          new_string: "y",
        },
        "2026-10-29T09:03:30.000Z"
      ),
      result("e2", "2026-10-29T09:03:31.000Z", true),
      call(
        "b1",
        "Bash",
        {
          command:
            "cd /repo && API_KEY=secret node /tmp/x/mockshot.js N-Undo --token abc",
        },
        "2026-10-29T09:04:00.000Z"
      ),
      result("b1", "2026-10-29T09:04:01.000Z"),
      call(
        "w2",
        "Write",
        { file_path: "/repo/.mock/modern/O-Undo.dc.html", content: "1\n2" },
        "2026-10-29T09:05:00.000Z",
        { requestedModel: "sonnet" }
      )
    )
  );

  const d = subagentDetail(transcript, "aundo", "/repo")!;
  assert.equal(d.agentId, "aundo");
  assert.equal(d.prompt, "Mock undo for a single diff hunk.");
  assert.deepEqual(
    d.lastTools.map((t) => [t.verb, t.target, t.running]),
    [
      ["Edited", "N-Undo.dc.html", false],
      ["Edited", "ui.css", false],
      ["Ran", "mockshot.js N-Undo", false],
      ["Writing", "O-Undo.dc.html", true],
    ]
  );
  assert.equal(d.lastTools[3].at, "2026-10-29T09:05:00.000Z");
  assert.equal(JSON.stringify(d).includes("secret"), false);
  assert.deepEqual(d.filesWritten, [
    { path: ".mock/modern/N-Undo.dc.html", added: 5, removed: 1 },
  ]);
  assert.deepEqual(d.usage, {
    input: 3,
    output: 40,
    cacheRead: 40_000,
    cacheCreation: 8_000,
  });
  assert.equal(d.model, "Sonnet 4.6");
  assert.equal(d.tokens, 48_043);
  assert.equal(d.contextWindow, 200_000);
  assert.equal(d.updatedAt, "2026-10-29T09:05:00.000Z");

  // Appended: the write's result and half a line, then the rest of it
  fs.appendFileSync(
    file,
    lines(result("w2", "2026-10-29T09:06:00.000Z")) +
      JSON.stringify(
        call("g1", "Grep", { pattern: "undo" }, "2026-10-29T09:07:00.000Z")
      ).slice(0, 30)
  );
  const d2 = subagentDetail(transcript, "aundo", "/repo")!;
  assert.deepEqual(
    d2.lastTools.map((t) => [t.verb, t.running]),
    [
      ["Edited", false],
      ["Edited", false],
      ["Ran", false],
      ["Wrote", false],
    ]
  );
  assert.deepEqual(d2.filesWritten[1], {
    path: ".mock/modern/O-Undo.dc.html",
    added: 2,
    removed: 0,
  });
  const full = JSON.stringify(
    call("g1", "Grep", { pattern: "undo" }, "2026-10-29T09:07:00.000Z", {
      requestedModel: "claude-sonnet-4-6[1m]",
    })
  );
  // Rewrite the half line whole: only complete lines are ever read
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(
    file,
    text.slice(0, text.lastIndexOf("\n") + 1) + full + "\n"
  );
  const d3 = subagentDetail(transcript, "aundo", "/repo")!;
  assert.deepEqual(d3.lastTools.at(-1), {
    tool: "Grep",
    verb: "Searching",
    target: "undo",
    at: "2026-10-29T09:07:00.000Z",
    running: true,
  });
  assert.equal(d3.contextWindow, 1_000_000);
});

test("a fork's prompt is its parent's Agent call; no file is null", () => {
  const { transcript, subs } = setup();
  fs.writeFileSync(
    path.join(subs, "agent-afork.jsonl"),
    lines(
      { type: "fork-context-ref", agentId: "afork" },
      call(
        "toolu_parent",
        "Agent",
        {
          subagent_type: "fork",
          prompt: "Design the mockup",
          description: "d",
        },
        "2026-10-29T09:00:00.000Z"
      ),
      {
        type: "user",
        timestamp: "2026-10-29T09:00:01.000Z",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_parent", content: "x" },
            { type: "text", text: "<fork-boilerplate>" },
          ],
        },
      },
      call("b1", "Bash", { command: "ls" }, "2026-10-29T09:01:00.000Z")
    )
  );
  const d = subagentDetail(transcript, "afork")!;
  assert.equal(d.prompt, "Design the mockup");
  assert.deepEqual(
    d.lastTools.map((t) => [t.tool, t.verb, t.target, t.running]),
    [["Bash", "Running", "ls", true]]
  );
  assert.equal(subagentDetail(transcript, "nope"), null);
  assert.equal(subagentDetail(transcript, "../etc"), null);
});

test("commandTarget keeps the program and its first words, never values", () => {
  assert.equal(commandTarget("ls -la"), "ls");
  assert.equal(
    commandTarget("cd /a && node /x/mockshot.js N-Undo 466 900"),
    "mockshot.js N-Undo 466"
  );
  assert.equal(commandTarget("S=/tmp/x; sed -n 1,2p $S/a"), "sed");
  assert.equal(commandTarget("GH_TOKEN=abc gh pr list"), "gh pr list");
  assert.equal(commandTarget("curl -H 'Authorization: x' url"), "curl");
  assert.equal(commandTarget("npx jest tests/unit"), "jest tests/unit");
  assert.equal(commandTarget("timeout 30 npm test"), "npm test");
  assert.equal(commandTarget("echo password=hunter2"), "echo");
  // A here-document's body is never shown
  assert.equal(
    commandTarget("python3 - <<'EOF'\np='x'\nEOF\nnode mockshot.js N-Undo"),
    "mockshot.js N-Undo"
  );
  assert.equal(commandTarget("cat > a.txt <<EOF\nsecret\nEOF"), "cat");
});

test("line counts and edit deltas", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("a"), 1);
  assert.equal(lineCount("a\nb\n"), 2);
  assert.deepEqual(editDelta("a\nb\nc", "a\nB\nc"), { added: 1, removed: 1 });
  assert.deepEqual(editDelta("", "x\ny"), { added: 2, removed: 0 });
  assert.deepEqual(editDelta("same", "same"), { added: 0, removed: 0 });
});

test("a workflow agent was asked the computed task, not the relayed request", () => {
  assert.equal(
    harnessTask("[Workflow harness — user request] relayed\n  Build it all"),
    null
  );
  assert.equal(
    harnessTask(
      "[Workflow harness — computed task] Notice.\n  \n  Mock undo for one hunk.\n  Reuse ui.css."
    )?.trim(),
    "Mock undo for one hunk.\nReuse ui.css."
  );
  assert.equal(harnessTask("Plain prompt"), "Plain prompt");
});
