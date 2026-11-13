import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foregroundGroup,
  isShell,
  isSuspendedScreen,
} from "../../lib/suspended";

const SCREEN = [
  "❯ Go ahead!",
  "",
  "✶ Wandering… (2s · thinking)",
  "",
  "────────────────",
  "❯ ",
  "Claude Code has been suspended. Run `fg` to bring Claude Code back.──────",
  "Note: ctrl + z now suspends Claude Code, ctrl + _ undoes input.",
  "^Zfg",
  "fg",
  "",
  "",
].join("\n");

test("the suspend notice at the bottom of the screen is seen", () => {
  assert.equal(isSuspendedScreen(SCREEN), true);
});

test("a normal screen, or the notice far up in scrollback, is not", () => {
  assert.equal(isSuspendedScreen("❯ hello\n  ⏵⏵ bypass permissions on"), false);
  const old =
    "Claude Code has been suspended. Run `fg`\n" +
    Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(isSuspendedScreen(old), false);
});

test("shells are told apart from agents", () => {
  assert.equal(isShell("bash"), true);
  assert.equal(isShell("-zsh"), true);
  assert.equal(isShell("claude"), false);
  assert.equal(isShell("node"), false);
});

test("the foreground group is read past a name with spaces and brackets", () => {
  const stat =
    "3548211 (my (odd) name) S 930 3548211 3548211 34821 3548299 4194304 1 2";
  assert.equal(foregroundGroup(stat), 3548299);
  assert.equal(foregroundGroup("12 (x) S 1 12 12 0 -1 0"), null);
  assert.equal(foregroundGroup("garbage"), null);
});
