import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyScreen,
  inputText,
  readiness,
  stripAnsi,
  type Readiness,
  type ScreenInput,
} from "../../lib/session-ready";
import type { HoldReason } from "../../lib/queue/types";
import type { Session } from "../../lib/db";

const FIXTURES = path.join(__dirname, "fixtures", "screens");

/** A recorded screen (capture-pane -p -e), as readiness splits it */
const screen = (name: string): string[] =>
  fs
    .readFileSync(path.join(FIXTURES, name), "utf8")
    .replace(/\n$/, "")
    .split("\n");

const IDLE_CLAUDE = { busy: false, pendingPermission: null };

function claude(name: string, extra: Partial<ScreenInput> = {}): Readiness {
  return classifyScreen({
    agentType: "claude",
    lines: screen(name),
    width: 80,
    paneInMode: false,
    claude: IDLE_CLAUDE,
    ...extra,
  });
}

function other(
  agentType: string,
  name: string,
  extra: Partial<ScreenInput> = {}
): Readiness {
  return classifyScreen({
    agentType,
    lines: screen(name),
    width: 80,
    paneInMode: false,
    status: "idle",
    ...extra,
  });
}

const held = (holdReason: HoldReason): Readiness => ({
  ready: false,
  holdReason,
});
const READY: Readiness = { ready: true, holdReason: null };

const tool = (tool_name: string) => ({
  tool_name,
  tool_input: {},
  agent_id: null,
  at: 0,
});

describe("classifyScreen: Claude truth table", () => {
  const cases: [string, string, Partial<ScreenInput>, Readiness][] = [
    ["idle at an empty prompt", "claude-idle.ansi", {}, READY],
    [
      "its reply asking a question is not a dialog",
      "claude-reply-asks.ansi",
      {},
      READY,
    ],
    ["placeholder text is not typing", "claude-placeholder.ansi", {}, READY],
    ["a grey suggestion is not typing", "claude-suggestion.ansi", {}, READY],
    [
      "busy per its hooks",
      "claude-idle.ansi",
      { claude: { busy: true, pendingPermission: null } },
      held("busy"),
    ],
    [
      "no hook state yet",
      "claude-idle.ansi",
      { claude: { busy: null, pendingPermission: null } },
      held("unknown"),
    ],
    [
      "no hook state at all",
      "claude-idle.ansi",
      { claude: null },
      held("unknown"),
    ],
    [
      "spinner with the footer's esc to interrupt",
      "claude-busy.ansi",
      {},
      held("busy"),
    ],
    [
      "spinner on a narrow pane (no footer hint)",
      "claude-busy-narrow.ansi",
      {},
      held("busy"),
    ],
    ["compacting", "claude-compacting.ansi", {}, held("busy")],
    [
      "waiting on its background work",
      "claude-background-wait.ansi",
      {},
      held("busy"),
    ],
    [
      "permission prompt on screen",
      "claude-permission.ansi",
      {},
      held("permission"),
    ],
    [
      "permission per its hooks only",
      "claude-idle.ansi",
      { claude: { busy: false, pendingPermission: tool("Bash") } },
      held("permission"),
    ],
    ["AskUserQuestion", "claude-ask.ansi", {}, held("asking")],
    [
      "AskUserQuestion per its hooks",
      "claude-idle.ansi",
      { claude: { busy: true, pendingPermission: tool("AskUserQuestion") } },
      held("asking"),
    ],
    [
      "plan approval",
      "claude-plan.ansi",
      { claude: { busy: true, pendingPermission: tool("ExitPlanMode") } },
      held("asking"),
    ],
    ["plan approval, screen only", "claude-plan.ansi", {}, held("asking")],
    ["folder trust dialog", "claude-trust.ansi", {}, held("asking")],
    ["/resume picker open", "claude-resume-picker.ansi", {}, held("asking")],
    ["/model picker open", "claude-model-picker.ansi", {}, held("asking")],
    ["copy mode", "claude-idle.ansi", { paneInMode: true }, held("typing")],
    ["half-typed input", "claude-typed.ansi", {}, held("typing")],
    [
      "half-typed, cursor mid-word",
      "claude-typed-cursor-mid.ansi",
      {},
      held("typing"),
    ],
    [
      "half-typed, no escapes captured",
      "claude-typed-plain.ansi",
      {},
      held("typing"),
    ],
    [
      "typed on the input's second line",
      "claude-typed-wrapped.ansi",
      {},
      held("typing"),
    ],
    [
      "unknown screen (no input box)",
      "claude-unknown.ansi",
      {},
      held("unknown"),
    ],
  ];
  for (const [name, file, extra, want] of cases) {
    test(name, () => assert.deepEqual(claude(file, extra), want));
  }
});

describe("classifyScreen: Codex and Gemini", () => {
  test("idle with nothing asked is ready", () => {
    assert.deepEqual(other("codex", "codex-idle.ansi"), READY);
    assert.deepEqual(
      other("gemini", "gemini-idle.ansi", { status: "waiting" }),
      READY
    );
  });

  test("working is busy, by screen or by status", () => {
    assert.deepEqual(other("codex", "codex-busy.ansi"), held("busy"));
    assert.deepEqual(
      other("codex", "codex-idle.ansi", { status: "running" }),
      held("busy")
    );
  });

  test("approval and trust screens are asking", () => {
    assert.deepEqual(other("codex", "codex-approval.ansi"), held("asking"));
    assert.deepEqual(other("codex", "codex-trust.ansi"), held("asking"));
    assert.deepEqual(other("gemini", "gemini-approval.ansi"), held("asking"));
  });

  test("no status, or a dead one, is unknown", () => {
    assert.deepEqual(
      other("codex", "codex-idle.ansi", { status: null }),
      held("unknown")
    );
    assert.deepEqual(
      other("gemini", "gemini-idle.ansi", { status: "dead" }),
      held("unknown")
    );
  });

  test("copy mode holds them too", () => {
    assert.deepEqual(
      other("codex", "codex-idle.ansi", { paneInMode: true }),
      held("typing")
    );
  });
});

describe("inputText", () => {
  test("reads typed text, not the placeholder or cursor", () => {
    assert.equal(inputText(screen("claude-idle.ansi")), "");
    assert.equal(inputText(screen("claude-placeholder.ansi")), "");
    assert.equal(inputText(screen("claude-typed.ansi")), "alsobumpthevers");
    assert.equal(inputText(screen("claude-unknown.ansi")), null);
  });

  test("stripAnsi leaves the text", () => {
    assert.equal(stripAnsi("\x1b[7ma\x1b[27m\x1b[38;5;246mb\x1b[0m"), "ab");
  });
});

describe("ended sessions", () => {
  test("paused and settled are held before tmux is asked (M4, M8)", async () => {
    const base = { id: "s-ended", agent_type: "claude" } as Session;
    assert.deepEqual(await readiness({ ...base, paused_at: 1 }), {
      ready: false,
      holdReason: "paused",
    });
    assert.deepEqual(await readiness({ ...base, settled_at: 1 }), {
      ready: false,
      holdReason: "settled",
    });
  });
});
