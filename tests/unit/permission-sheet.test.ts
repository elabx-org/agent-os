import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentName,
  canRestartHere,
  fullAccessConfirm,
  initialChoice,
  isWaiting,
  modeToast,
  needsPost,
  sheetNote,
  waitingText,
} from "../../lib/permission-sheet";
import type { PermissionModeState } from "../../lib/permission-mode";

const STATE: PermissionModeState = {
  mode: "acceptEdits",
  pending: null,
  live: "acceptEdits",
  canApplyLive: true,
  agentType: "claude",
};

test("starts on the mode, or the change waiting for the turn", () => {
  assert.equal(initialChoice(undefined), null);
  assert.equal(initialChoice(STATE), "acceptEdits");
  assert.equal(initialChoice({ ...STATE, pending: "auto" }), "auto");
  // What Claude runs beats the stored mode, as on the chip
  assert.equal(initialChoice({ ...STATE, live: "manual" }), "manual");
  assert.equal(initialChoice({ ...STATE, live: null }), "acceptEdits");
});

test("waiting only while the pending mode differs from the one running", () => {
  assert.equal(isWaiting(undefined), false);
  assert.equal(isWaiting(STATE), false);
  assert.equal(isWaiting({ ...STATE, pending: "auto" }), true);
  assert.equal(isWaiting({ ...STATE, pending: "acceptEdits" }), false);
  assert.equal(
    isWaiting({ ...STATE, live: null, mode: "manual", pending: "auto" }),
    true
  );
});

test("Done with the row it opened on only closes", () => {
  assert.equal(needsPost("acceptEdits", STATE), false);
  assert.equal(needsPost("auto", STATE), true);
  assert.equal(needsPost(null, STATE), false);
  assert.equal(needsPost("auto", undefined), false);
  // A pending change: picking it again is nothing new, the current mode cancels it
  const pending = { ...STATE, pending: "auto" as const };
  assert.equal(needsPost("auto", pending), false);
  assert.equal(needsPost("acceptEdits", pending), true);
});

test("toast per appliesAt", () => {
  assert.deepEqual(modeToast({ mode: "auto", appliesAt: "now" }, "claude"), {
    text: "Auto on",
    restart: false,
  });
  assert.deepEqual(
    modeToast({ mode: "manual", appliesAt: "nextTurn" }, "claude"),
    { text: "Ask first from the next turn", restart: false }
  );
  assert.deepEqual(
    modeToast({ mode: "bypassPermissions", appliesAt: "restart" }, "claude"),
    { text: "Full access after a restart", restart: true }
  );
  assert.deepEqual(modeToast({ mode: "auto", appliesAt: "restart" }, "codex"), {
    text: "Codex takes this when it restarts",
    restart: false,
  });
  assert.deepEqual(
    modeToast({ mode: "auto", appliesAt: "restart" }, "gemini"),
    { text: "Gemini takes this when it restarts", restart: false }
  );
  assert.deepEqual(
    modeToast({ mode: "auto", appliesAt: "nextLaunch" }, "codex"),
    { text: "Applies when it starts", restart: false }
  );
});

test("only Claude restarts from the sheet (the route refuses others)", () => {
  assert.equal(canRestartHere("claude"), true);
  assert.equal(canRestartHere("codex"), false);
  assert.equal(canRestartHere("minimax"), false);
  assert.equal(
    modeToast({ mode: "bypassPermissions", appliesAt: "restart" }, "minimax")
      .restart,
    false
  );
  assert.equal(agentName("opencode"), "The agent");
});

test("full access confirm names the session", () => {
  const c = fullAccessConfirm("Signing profiles");
  assert.equal(c.title, "Switch Signing profiles to full access?");
  assert.equal(c.message, "It will never ask, even to delete files.");
  assert.equal(c.destructive, true);
});

test("the waiting row says what it waits for", () => {
  assert.equal(waitingText(STATE), null);
  assert.equal(
    waitingText({ ...STATE, pending: "auto", pendingAppliesAt: "nextTurn" }),
    "Waiting for this turn to end"
  );
  assert.equal(
    waitingText({
      ...STATE,
      pending: "bypassPermissions",
      pendingAppliesAt: "restart",
    }),
    "Waiting for a restart"
  );
  // An older server leaves the reason out: the turn's end
  assert.equal(
    waitingText({ ...STATE, pending: "auto" }),
    "Waiting for this turn to end"
  );
});

test("the note says the next turn only while picks wait for it", () => {
  const mock =
    "Applies from the next turn. Codex and Gemini use their closest matching setting.";
  assert.equal(sheetNote(undefined), mock);
  assert.equal(sheetNote({ ...STATE, atIdle: true }), mock);
  assert.equal(sheetNote(STATE), mock);
  assert.match(sheetNote({ ...STATE, atIdle: false }), /^Applies right away/);
});
