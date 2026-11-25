import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePermissionPrompt } from "../../lib/permission-prompt";
import { checkWaitingPatterns } from "../../lib/status-detector";
import { adaptiveRow, barSpecs } from "../../lib/adaptive-keys";

// Claude Code 2.1.330 draws this after a turn. No hook announces it, its
// footer is in lower case without "to", and its rows sit a column deeper
// than a permission request's
const rule = "─".repeat(120);
const compact = (cursor: 1 | 2) => [
  "⏺ Done.",
  "",
  rule,
  "  We recommend compacting earlier",
  "",
  "  Each message re-sends the whole conversation, so long conversations use up your plan's usage limits faster.",
  "",
  "  Want to autocompact at 400k tokens instead? Your model doesn't change. Switch back any time with /autocompact.",
  "",
  `  ${cursor === 1 ? "❯" : " "} Autocompact at ‹ 400k › tokens`,
  `  ${cursor === 2 ? "❯" : " "} Keep auto (1m tokens)`,
  "",
  "  ↑/↓ choose · ←/→ change size · enter confirm · esc not now",
  "",
];

test("Claude's own menu is read as something to answer", () => {
  const prompt = parsePermissionPrompt(compact(2), 120);
  assert.ok(prompt);
  assert.equal(prompt.title, "We recommend compacting earlier");
  assert.deepEqual(
    prompt.options.map((o) => o.label),
    ["Autocompact at ‹ 400k › tokens", "Keep auto (1m tokens)"]
  );
  assert.equal(prompt.selected, 1);
  assert.equal(prompt.menu, true);
  assert.equal(parsePermissionPrompt(compact(1), 120)?.selected, 0);
});

test("a session showing it is waiting, not idle", () => {
  assert.equal(checkWaitingPatterns(compact(2).join("\n")), true);
});

test("its footer alone, with nothing to choose, is not a prompt", () => {
  const lines = [
    "⏺ Press enter confirm the change.",
    "",
    rule,
    "❯ ",
    rule,
    "  ⏵⏵ auto mode on (shift+tab to cycle)",
  ];
  assert.equal(parsePermissionPrompt(lines, 120), null);
  assert.equal(
    parsePermissionPrompt(
      [rule, "  A note", "", "  ↑/↓ choose · enter confirm · esc not now"],
      120
    ),
    null
  );
});

test("a permission request still reads as before", () => {
  const prompt = parsePermissionPrompt(
    [
      rule,
      " Bash command",
      "",
      "   touch inbox-test.txt",
      "   Create empty file",
      "",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and don't ask again for touch commands in",
      "      /config/workspace",
      "   3. No",
      "",
      " Esc to cancel · Tab to amend",
    ],
    120
  );
  assert.ok(prompt);
  assert.deepEqual(
    prompt.options.map((o) => o.kind),
    ["allow", "always", "deny"]
  );
  assert.equal(prompt.question, "Do you want to proceed?");
  assert.equal(prompt.menu, undefined);
});

test("the touch key row for it has arrows, not numbers", () => {
  const row = adaptiveRow("menu", 2);
  assert.deepEqual(
    row.map((k) => k.label),
    ["↑", "↓", "←", "→", "Esc", "↵"]
  );
  assert.equal(row.find((k) => k.label === "→")?.key, "\x1b[C");
  const bar = barSpecs("menu", 2);
  assert.ok(!bar.some((spec) => spec.startsWith("digit-")));
  for (const id of ["arrow-up", "arrow-down", "arrow-left", "arrow-right"]) {
    assert.ok(
      bar.some((spec) => spec.startsWith(`${id}/`)),
      id
    );
  }
  // A numbered question keeps its number keys
  assert.deepEqual(
    adaptiveRow("asks", 2).map((k) => k.label),
    ["1", "2", "Esc", "↵"]
  );
});
