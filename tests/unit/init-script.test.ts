import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachLines,
  backgroundJobId,
  cdLine,
  generateInitScript,
  shellIn,
} from "../../lib/init-script";

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

test("a session's script goes into its own folder before the agent", () => {
  const script = generateInitScript(
    "claude --model sonnet",
    undefined,
    "/Users/someone/it's here/app"
  );
  const cd = script.indexOf(
    `cd -- '/Users/someone/it'\\''s here/app' 2>/dev/null || cd -- "$HOME" 2>/dev/null`
  );
  assert.ok(cd > 0, "the folder is quoted whole");
  assert.ok(cd < script.indexOf("exec claude --model sonnet"));
  // No folder known: as before
  assert.doesNotMatch(generateInitScript("claude"), /\ncd -- /);
});

test("the folder line: home for ~, nothing without a folder", () => {
  assert.equal(cdLine(undefined), "");
  assert.equal(cdLine(""), "");
  assert.match(cdLine("~/code"), /^cd -- '\/[^~]*\/code' /);
  assert.match(
    cdLine("/a/b"),
    /^cd -- '\/a\/b' 2>\/dev\/null \|\| cd -- "\$HOME" 2>\/dev\/null\n$/
  );
});

test("a shell session: the login shell, in its folder", () => {
  assert.equal(
    shellIn("/a/b c"),
    `cd -- '/a/b c' 2>/dev/null || cd -- "$HOME" 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`
  );
});
