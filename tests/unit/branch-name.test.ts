import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchForFeature,
  branchFromTask,
  branchKind,
} from "../../lib/branch-name";

test("branchFromTask: nothing to name it after gives ''", () => {
  assert.equal(branchFromTask(""), "");
  assert.equal(branchFromTask("   "), "");
  assert.equal(branchFromTask("?!… --"), "");
  // Only the verb and stop words
  assert.equal(branchFromTask("Fix it"), "");
  assert.equal(branchFromTask("日本語のタスク"), "");
});

test("branchFromTask: the mocks' tasks", () => {
  assert.equal(
    branchFromTask("Regenerate the development signing profile"),
    "chore/dev-signing-profile"
  );
  assert.equal(
    branchFromTask("Make the half-folded state line open the live activity"),
    "feat/half-folded-state-line"
  );
});

test("branchKind: a fix word anywhere wins over the verb", () => {
  assert.equal(branchKind("Fix the deck live activity"), "fix");
  assert.equal(branchKind("Settings won't scroll on iPad"), "fix");
  assert.equal(branchKind("The banner doesn't close"), "fix");
  assert.equal(branchKind("Add a guard, the sync is broken"), "fix");
  assert.equal(branchKind("Login crashes on start"), "fix");
});

test("branchKind: feat, docs, refactor and chore", () => {
  assert.equal(branchKind("Add dark mode to settings"), "feat");
  assert.equal(branchKind("Build a usage card"), "feat");
  assert.equal(branchKind("New project picker"), "feat");
  assert.equal(branchKind("Explain setup in the README"), "docs");
  assert.equal(branchKind("Update docs for scripts"), "docs");
  assert.equal(branchKind("Refactor the queue dispatcher"), "refactor");
  assert.equal(branchKind("Clean up old migrations"), "refactor");
  assert.equal(branchKind("Bump react to 19"), "chore");
  assert.equal(branchKind("Update deps"), "chore");
  assert.equal(branchKind("Upgrade next"), "chore");
  // Update on its own is a change to something, not upkeep
  assert.equal(branchKind("Update the header copy"), "feat");
});

test("branchFromTask: leading verb and stop words dropped, four words kept", () => {
  assert.equal(
    branchFromTask("Add dark mode toggle to the settings page for phones"),
    "feat/dark-mode-toggle-settings"
  );
  assert.equal(branchFromTask("Bump react to 19"), "chore/react-19");
  assert.equal(
    branchFromTask("Settings won't scroll when the keyboard is up"),
    "fix/settings-wont-scroll-keyboard"
  );
  assert.equal(
    branchFromTask("Fix crash when opening the configuration"),
    "fix/crash-opening-config"
  );
});

test("branchFromTask: at most 40 characters, never a trailing '-'", () => {
  const long = branchFromTask(
    "Implement internationalization localization infrastructure everywhere"
  );
  assert.ok(long.length <= 40, long);
  assert.ok(!long.endsWith("-"));
  assert.equal(long, "feat/internationalization-localization");
  const one = branchFromTask("Add " + "x".repeat(80));
  assert.equal(one, "feat/" + "x".repeat(35));
  assert.equal(one.length, 40);
});

test("branchFromTask: punctuation, case and accents", () => {
  assert.equal(
    branchFromTask("  Add “Café” menu — résumé, NOW!!  "),
    "feat/cafe-menu-resume-now"
  );
  assert.equal(
    branchFromTask("add_snake_case.helpers"),
    "feat/snake-case-helpers"
  );
  assert.equal(branchFromTask("Fix 🐛 in parser"), "fix/parser");
});

test("branchForFeature: mirrors the server's branch for a featureName", () => {
  assert.equal(
    branchForFeature("fix/deck-live-activity"),
    "fix/deck-live-activity"
  );
  assert.equal(branchForFeature("chore/dev-profile"), "chore/dev-profile");
  assert.equal(branchForFeature("swift-falcon"), "feature/swift-falcon");
  // Its own result again (the branch field edited and left)
  assert.equal(
    branchForFeature("feature/swift-falcon"),
    "feature/swift-falcon"
  );
  assert.equal(branchForFeature("My Thing"), "feature/my-thing");
  // Not a kind we make, or not a clean slug: slugged whole
  assert.equal(branchForFeature("hotfix/x"), "feature/hotfix-x");
  assert.equal(branchForFeature("fix/Bad Name"), "feature/fix-bad-name");
});
