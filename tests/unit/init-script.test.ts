import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundJobId } from "../../lib/init-script";

const ID = "66f433db-1097-4137-83a6-fa823fded280";

test("a Claude resume may be in Claude's background agents", () => {
  assert.equal(
    backgroundJobId(`claude --resume ${ID} --model sonnet`),
    "66f433db"
  );
  assert.equal(
    backgroundJobId(
      `claude --model sonnet --resume /x/.claude/projects/p/${ID}.jsonl`
    ),
    "66f433db"
  );
});

test("anything but a plain Claude resume isn't", () => {
  assert.equal(backgroundJobId("claude --model sonnet"), null);
  assert.equal(backgroundJobId(`claude --resume ${ID} --fork-session`), null);
  assert.equal(backgroundJobId(`codex resume ${ID}`), null);
  assert.equal(backgroundJobId(`claude-minimax --resume ${ID}`), null);
  assert.equal(backgroundJobId(`claude --continue 'about ${ID}'`), null);
});
