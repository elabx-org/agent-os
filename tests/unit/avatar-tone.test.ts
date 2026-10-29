import { test } from "node:test";
import assert from "node:assert/strict";
import { agentAvatar, agentName, avatarTone } from "../../components/a/Avatar";

test("avatarTone: each agent its tone, the rest other", () => {
  assert.equal(avatarTone("claude"), "claude");
  assert.equal(avatarTone("codex"), "codex");
  assert.equal(avatarTone("gemini"), "gemini");
  assert.equal(avatarTone("shell"), "shell");
  assert.equal(avatarTone("aider"), "other");
  assert.equal(avatarTone("something-new"), "other");
});

test("avatarTone: no type is Claude, the sessions' default", () => {
  assert.equal(avatarTone(null), "claude");
  assert.equal(avatarTone(undefined), "claude");
  assert.equal(avatarTone(""), "claude");
});

test("agentAvatar: the mocks' letters", () => {
  assert.deepEqual(agentAvatar("claude"), { label: "C", tone: "claude" });
  assert.deepEqual(agentAvatar("codex"), { label: "X", tone: "codex" });
  assert.deepEqual(agentAvatar("cursor"), { label: "Cu", tone: "other" });
});

test("agentName: short names, unknown types as they are", () => {
  assert.equal(agentName("claude"), "Claude");
  assert.equal(agentName(null), "Claude");
  assert.equal(agentName("gemini"), "Gemini");
  assert.equal(agentName("new-agent"), "new-agent");
});
