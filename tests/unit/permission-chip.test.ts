import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chipModel,
  hasPermissionModes,
} from "../../components/Session/permission-chip-model";
import type { PermissionModeState } from "../../lib/permission-mode";

function state(over: Partial<PermissionModeState> = {}): PermissionModeState {
  return {
    mode: "acceptEdits",
    pending: null,
    live: null,
    canApplyLive: false,
    agentType: "claude",
    ...over,
  };
}

test("agents with modes get a chip; shell and Cursor don't", () => {
  for (const a of ["claude", "codex", "gemini", "minimax"] as const)
    assert.equal(hasPermissionModes(a), true, a);
  assert.equal(hasPermissionModes("shell"), false);
  assert.equal(hasPermissionModes("cursor"), false);
  assert.equal(chipModel(state({ agentType: "shell" }), "shell"), null);
});

test("nothing while loading", () => {
  assert.equal(chipModel(undefined, "claude"), null);
  assert.equal(chipModel(null, "claude"), null);
});

test("the stored mode, labelled as N-PermMode", () => {
  const chip = chipModel(state(), "claude")!;
  assert.equal(chip.label, "Accept edits");
  assert.equal(chip.ariaLabel, "Permissions: Accept edits");
  assert.equal(chip.tone, "set");
  assert.equal(chip.pending, false);
  assert.equal(chip.title, undefined);
});

test("what Claude reports running wins over the stored mode", () => {
  const chip = chipModel(state({ mode: "manual", live: "auto" }), "claude")!;
  assert.equal(chip.mode, "auto");
  assert.equal(chip.label, "Auto");
});

test("a waiting mode shows with a dot, from the next turn", () => {
  const chip = chipModel(state({ pending: "auto" }), "claude")!;
  assert.equal(chip.mode, "auto");
  assert.equal(chip.pending, true);
  assert.equal(chip.title, "From the next turn");
  assert.equal(chip.ariaLabel, "Permissions: Auto, from the next turn");
});

test("a pending equal to the mode in force is no longer waiting", () => {
  const chip = chipModel(
    state({ mode: "manual", live: "auto", pending: "auto" }),
    "claude"
  )!;
  assert.equal(chip.pending, false);
  assert.equal(chip.title, undefined);
});

test("full access is red, stored or pending", () => {
  assert.equal(
    chipModel(state({ mode: "bypassPermissions" }), "claude")!.tone,
    "danger"
  );
  const pending = chipModel(
    state({ mode: "auto", pending: "bypassPermissions" }),
    "codex"
  )!;
  assert.equal(pending.tone, "danger");
  assert.equal(pending.label, "Full access");
});
