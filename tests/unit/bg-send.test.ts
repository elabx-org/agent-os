import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshSessionInput,
  isUntouched,
  sendChoiceForKey,
  sendMenuItems,
  sentToastTitle,
  type SendKey,
} from "../../lib/bg-send";
import type { Session } from "../../lib/db";

test("sendMenuItems: the mock's rows, queue only when on", () => {
  assert.deepEqual(sendMenuItems({ queueOn: true, mac: true }), [
    { choice: "send", label: "Send", caption: null, hint: "Enter" },
    {
      choice: "sendAndNew",
      label: "Send and start a new session",
      caption: "Keeps this one running",
      hint: "⌘ Enter",
    },
    {
      choice: "queue",
      label: "Send to queue",
      caption: "After the current turn",
      hint: null,
    },
  ]);
  const off = sendMenuItems({ queueOn: false, mac: false });
  assert.deepEqual(
    off.map((i) => i.choice),
    ["send", "sendAndNew"]
  );
  assert.equal(off[1].hint, "Ctrl Enter");
});

const key = (k: Partial<SendKey> = {}): SendKey => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  ...k,
});

test("sendChoiceForKey: Return sends, ⌘/Ctrl Return starts a new one", () => {
  for (const mac of [true, false]) {
    assert.equal(sendChoiceForKey(key(), mac), "send");
    assert.equal(sendChoiceForKey(key({ shiftKey: true }), mac), null);
    assert.equal(sendChoiceForKey(key({ altKey: true }), mac), null);
    assert.equal(sendChoiceForKey(key({ isComposing: true }), mac), null);
    assert.equal(sendChoiceForKey(key({ key: "a" }), mac), null);
    assert.equal(
      sendChoiceForKey(key({ metaKey: true, ctrlKey: true }), mac),
      null
    );
    assert.equal(
      sendChoiceForKey(key({ metaKey: true, shiftKey: true }), mac),
      null
    );
  }
  assert.equal(sendChoiceForKey(key({ metaKey: true }), true), "sendAndNew");
  assert.equal(sendChoiceForKey(key({ ctrlKey: true }), true), null);
  assert.equal(sendChoiceForKey(key({ ctrlKey: true }), false), "sendAndNew");
  assert.equal(sendChoiceForKey(key({ metaKey: true }), false), null);
});

const session = (s: Partial<Session> = {}): Session =>
  ({
    id: "s1",
    name: "Deck state line fix",
    working_directory: "/repo",
    worktree_path: null,
    project_id: "p1",
    agent_type: "claude",
    model: "opus",
    auto_approve: false,
    permission_mode: null,
    ...s,
  }) as Session;

test("freshSessionInput: same project, agent, model; nothing else", () => {
  assert.deepEqual(freshSessionInput(session(), "/repo"), {
    workingDirectory: "/repo",
    projectId: "p1",
    agentType: "claude",
    model: "opus",
    permissionMode: null,
    autoApprove: false,
    useWorktree: false,
    createBranch: false,
    featureName: null,
    baseBranch: null,
    continueSession: false,
    useTmux: true,
    initialPrompt: null,
  });
  const input = freshSessionInput(session({ model: "" }));
  assert.equal(input.model, undefined);
  assert.equal("name" in input, false);
});

test("freshSessionInput: a worktree session's fresh one starts in the project", () => {
  const wt = session({
    worktree_path: "/home/.agent-os/worktrees/x",
    working_directory: "/home/.agent-os/worktrees/x",
  });
  assert.equal(freshSessionInput(wt, "/repo").workingDirectory, "/repo");
  // No project folder known: stays where it was
  assert.equal(
    freshSessionInput(wt, null).workingDirectory,
    "/home/.agent-os/worktrees/x"
  );
  assert.equal(
    freshSessionInput(session({ working_directory: "/sub" }), "/repo")
      .workingDirectory,
    "/sub"
  );
});

test("freshSessionInput: the mode wins over auto approve", () => {
  const full = freshSessionInput(
    session({ permission_mode: "bypassPermissions", auto_approve: true })
  );
  assert.equal(full.permissionMode, "bypassPermissions");
  assert.equal(full.autoApprove, false);
  const legacy = freshSessionInput(session({ auto_approve: true }));
  assert.equal(legacy.permissionMode, null);
  assert.equal(legacy.autoApprove, true);
  assert.equal(
    freshSessionInput(session({ permission_mode: "junk" })).permissionMode,
    null
  );
  assert.equal(
    freshSessionInput(session({ agent_type: "" as Session["agent_type"] }))
      .agentType,
    "claude"
  );
});

test("sentToastTitle", () => {
  assert.equal(
    sentToastTitle("Deck state line fix"),
    "Sent to Deck state line fix"
  );
});

test("isUntouched: only when nothing happened", () => {
  const none = { sent: false, hasTranscript: false, queued: false };
  assert.equal(isUntouched(none), true);
  assert.equal(isUntouched({ ...none, sent: true }), false);
  assert.equal(isUntouched({ ...none, hasTranscript: true }), false);
  assert.equal(isUntouched({ ...none, queued: true }), false);
});
