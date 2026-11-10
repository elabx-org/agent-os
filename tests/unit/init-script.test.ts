import { test } from "node:test";
import assert from "node:assert/strict";
import { attachLines, backgroundJobId } from "../../lib/init-script";

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

test("a stopped job resumes here rather than attaching (Bring back here)", () => {
  const lines = attachLines(`claude --resume ${ID}`);
  assert.match(lines, /claude agents --json --all/);
  assert.match(lines, /""\|\*'"stopped"'\) ;;/);
  assert.match(lines, /claude attach [0-9a-f]{8} 2>\/dev\/null && exit 0/);
  assert.equal(attachLines("claude --model sonnet"), "");
});
