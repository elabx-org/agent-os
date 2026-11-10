import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachBackgroundCommand,
  backgroundAgentOfTmux,
  backgroundTmuxName,
} from "../../lib/background-tmux";

test("a background agent's tmux names it, and nothing else does", () => {
  assert.equal(backgroundTmuxName("64711d80"), "bg-64711d80");
  assert.equal(backgroundAgentOfTmux("bg-64711d80"), "64711d80");
  assert.equal(backgroundAgentOfTmux("claude-0ee5704a"), null);
  assert.equal(backgroundAgentOfTmux("shell-abc"), null);
  assert.equal(backgroundAgentOfTmux("bg--rf"), null);
  assert.equal(backgroundAgentOfTmux("bg-a;b"), null);
  assert.equal(backgroundAgentOfTmux(null), null);
});

test("attaching it reuses its tmux, else opens it in a new one", () => {
  const cmd = attachBackgroundCommand("64711d80");
  assert.match(
    cmd,
    /^tmux attach -t bg-64711d80 2>\/dev\/null \|\| tmux new -s bg-64711d80 /
  );
  assert.match(cmd, /exec claude attach 64711d80"$/);
  assert.throws(() => attachBackgroundCommand("x; rm -rf ~"));
});
