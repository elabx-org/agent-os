import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planOfTranscript } from "../../lib/claude-plan-tail";

const todo = (id: string, list: [string, string][], tokens: number) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id,
          name: "TodoWrite",
          input: {
            todos: list.map(([content, status]) => ({
              content,
              status,
              activeForm: "",
            })),
          },
        },
      ],
      usage: { input_tokens: tokens },
    },
  }) + "\n";

const said = (tokens: number) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text: "x".repeat(200) }],
      usage: { input_tokens: tokens },
    },
  }) + "\n";

test("reads the tail once, then only what was appended", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-plan-"));
  const file = path.join(dir, "t.jsonl");
  try {
    fs.writeFileSync(file, todo("a", [["One", "in_progress"]], 10));
    const first = await planOfTranscript(file);
    assert.equal(first.plan?.total, 1);
    assert.equal(first.tokens, 10);

    // Nothing new: the same answer, unread
    assert.equal(await planOfTranscript(file), first);

    // Lines without plan calls keep the plan and move the tokens on; a
    // line still being written waits for its newline
    fs.appendFileSync(file, said(20) + said(30).slice(0, 20));
    const second = await planOfTranscript(file);
    assert.equal(second.plan?.total, 1);
    assert.equal(second.tokens, 20);

    fs.appendFileSync(
      file,
      said(30).slice(20) +
        todo(
          "b",
          [
            ["One", "completed"],
            ["Two", "in_progress"],
          ],
          40
        )
    );
    const third = await planOfTranscript(file);
    assert.equal(third.plan?.done, 1);
    assert.equal(third.plan?.total, 2);
    assert.equal(third.tokens, 40);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
