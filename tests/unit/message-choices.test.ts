import { test } from "node:test";
import assert from "node:assert/strict";
import { messageChoices } from "../../lib/message-choices";

const labels = (text: string) =>
  messageChoices(text)?.choices.map((c) => c.label) ?? null;

test("lettered options before the question", () => {
  const r = messageChoices(
    [
      "Two ways to do it:",
      "",
      "**A.** Keep it in memory — fast, gone on restart",
      "**B.** SQLite table — survives restarts",
      "",
      "Which do you want?",
    ].join("\n")
  );
  assert.equal(r?.kind, "list");
  assert.equal(r?.question, "Which do you want?");
  assert.deepEqual(
    r?.choices.map((c) => [c.label, c.reply, c.detail]),
    [
      ["A. Keep it in memory", "A. Keep it in memory", "fast, gone on restart"],
      ["B. SQLite table", "B. SQLite table", "survives restarts"],
    ]
  );
});

test("numbered options need a choosing question", () => {
  const list = ["1. Turn off the builder", "2. Get machines back", "3. Both"];
  assert.deepEqual(labels([...list, "", "Which option?"].join("\n")), [
    "1. Turn off the builder",
    "2. Get machines back",
    "3. Both",
  ]);
  // Steps, then a go-ahead: yes or no, not the steps
  assert.deepEqual(labels([...list, "", "Want me to start?"].join("\n")), [
    "Yes",
    "No",
  ]);
});

test("lists out of order or too long are not options", () => {
  assert.equal(messageChoices("2. b\n3. c\n\nWhich one?")?.kind ?? null, null);
  const seven = Array.from({ length: 7 }, (_, i) => `${i + 1}. item`);
  assert.equal(messageChoices([...seven, "Which one?"].join("\n")), null);
});

test("two alternatives in the question", () => {
  assert.deepEqual(
    labels(
      "Done.\n\nWant me to do that change now, or leave it for a fresh session?"
    ),
    ["Do that change now", "Leave it for a fresh session"]
  );
  assert.deepEqual(
    labels(
      "Want me to send you the .p12 files directly, or are you pulling them off Titan yourself?"
    ),
    ["Send you the .p12 files directly", "Pulling them off Titan yourself"]
  );
});

test("a go-ahead is yes or no; an either-or isn't", () => {
  assert.deepEqual(labels("Shall I run the probe?"), ["Yes", "No"]);
  assert.equal(
    messageChoices("Want me to do it before or after the commit?"),
    null
  );
});

test("no question at the end, no choices", () => {
  assert.equal(messageChoices("Which one? Done, merged and deployed."), null);
  assert.equal(messageChoices("All 28 checks pass."), null);
  assert.equal(
    messageChoices("Is this right?\n\n" + "More text. ".repeat(20)),
    null
  );
  // A question in a code block isn't one
  assert.equal(messageChoices("```\nok?\n```"), null);
});

test("an open question has no choices", () => {
  assert.equal(messageChoices("What should the cache be called?"), null);
});
