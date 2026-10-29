import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedText,
  fullAccessNote,
  isAnswerableQuestion,
  latestBlocked,
  shortLabel,
  splitOptions,
  toolSummary,
} from "../../lib/permission-card";
import type { AgentAction } from "../../lib/agent-actions";
import type {
  PermissionPrompt,
  PromptOption,
} from "../../lib/permission-prompt";
import type { ReplyContext } from "../../lib/reply-context";

const opt = (index: number, label: string, kind: PromptOption["kind"]) => ({
  index,
  label,
  kind,
});

const prompt = (options: PromptOption[]): PermissionPrompt => ({
  title: "Bash command",
  description: "",
  detail: "docker compose restart herald",
  question: "Do you want to proceed?",
  options,
  selected: 0,
});

const context = (over: Partial<ReplyContext>): ReplyContext => ({
  kind: "ask",
  label: "Claude asks",
  question: "Keep the old strip?",
  excerpt: "",
  text: "",
  options: [],
  sourceId: null,
  toolName: "AskUserQuestion",
  ts: null,
  ...over,
});

const action = (over: Partial<AgentAction>): AgentAction => ({
  actor: "Stack health check",
  actorSessionId: "s1",
  action: "prompt_answer",
  allowed: false,
  detail: null,
  at: 1000,
  ...over,
});

test("isAnswerableQuestion: only a pending AskUserQuestion", () => {
  const question = prompt([
    opt(0, "Keep it", "other"),
    opt(1, "Remove it", "other"),
  ]);
  assert.equal(isAnswerableQuestion(context({}), question), true);
  // Unknown context fails closed
  assert.equal(isAnswerableQuestion(null, question), false);
  assert.equal(
    isAnswerableQuestion(context({ kind: "permission" }), question),
    false
  );
  assert.equal(
    isAnswerableQuestion(context({ toolName: "Bash" }), question),
    false
  );
  // A permission dialog on screen while the ask is still pending
  const permission = prompt([
    opt(0, "Yes", "allow"),
    opt(1, "Yes, and don't ask again for docker", "always"),
    opt(2, "No", "deny"),
  ]);
  assert.equal(isAnswerableQuestion(context({}), permission), false);
});

test("splitOptions and shortLabel: Allow / Deny on the main row", () => {
  const options = [
    opt(0, "Yes", "allow"),
    opt(1, "Yes, and don't ask again for docker", "always"),
    opt(2, "No, and tell Claude what to do differently", "deny"),
  ];
  const { main, more } = splitOptions(options);
  assert.deepEqual(
    main.map((o) => o.index),
    [0, 2]
  );
  assert.equal(more, true);
  assert.deepEqual(main.map(shortLabel), ["Allow", "Deny"]);
  assert.equal(shortLabel(options[1]), options[1].label);
  // A question keeps its first two answers and their labels
  const q = splitOptions([
    opt(0, "Keep it", "other"),
    opt(1, "Remove it", "other"),
  ]);
  assert.deepEqual(q.main.map(shortLabel), ["Keep it", "Remove it"]);
  assert.equal(q.more, false);
});

test("latestBlocked: newest refused attempt since the request", () => {
  const actions = [
    action({ at: 3000, allowed: true }),
    action({ at: 2500 }),
    action({ at: 900 }),
    action({ at: 2000, action: "keys" }),
  ];
  assert.equal(latestBlocked(actions, 1000)?.at, 2500);
  assert.equal(latestBlocked(actions, 2600), null);
  assert.equal(latestBlocked([], 0), null);
});

test("blockedText names the actor and what it tried", () => {
  assert.equal(
    blockedText(action({})),
    "Stack health check tried to allow this for you and was blocked"
  );
  assert.equal(
    blockedText(action({ actor: null, action: "permission_mode" })),
    "An agent tried to switch on full access and was blocked"
  );
});

test("fullAccessNote: now, next turn with restart, or at restart", () => {
  assert.deepEqual(
    fullAccessNote({ appliedNow: true, needsRestart: false }, true),
    {
      text: "Full access is on",
      restart: false,
    }
  );
  assert.deepEqual(
    fullAccessNote({ appliedNow: false, needsRestart: true }, true),
    {
      text: "Full access from the next turn",
      restart: true,
    }
  );
  assert.deepEqual(
    fullAccessNote({ appliedNow: false, needsRestart: true }, false),
    {
      text: "Applies when the session restarts",
      restart: false,
    }
  );
});

test("toolSummary picks the input that says what the call is about", () => {
  const tool = (input: unknown) => ({
    tool_name: "Bash",
    tool_input: input,
    agent_id: null,
    at: 0,
  });
  assert.equal(toolSummary(tool({ command: "ls", description: "List" })), "ls");
  assert.equal(toolSummary(tool({ file_path: "/a.ts" })), "/a.ts");
  assert.equal(toolSummary(tool(null)), "");
});
