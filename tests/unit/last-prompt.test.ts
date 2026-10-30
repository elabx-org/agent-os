import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPromptRow } from "../../lib/last-prompt";

test("the last message, not the input box", () => {
  const rows = [
    "> first question",
    "⏺ An answer",
    "",
    "> Why am I getting this error?",
    "⏺ Reading /tmp/x.png",
    "  lots of output",
    "──────────────────────────────",
    "> ",
    "──────────────────────────────",
    "  ? for shortcuts",
  ];
  assert.equal(lastPromptRow(rows), 3);
});

test("a draft typed in the box isn't a message", () => {
  assert.equal(
    lastPromptRow([
      "❯ sent",
      "out",
      "──────────",
      "❯ half typed",
      "──────────",
    ]),
    0
  );
});

test("none", () => {
  assert.equal(lastPromptRow(["$ ls", "a b"]), -1);
});
