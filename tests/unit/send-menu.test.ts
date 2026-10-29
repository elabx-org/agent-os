import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialSendIndex,
  offeredSendItems,
  sendMenuAvailable,
  stepSendIndex,
} from "../../components/Composer/send-menu-model";
import type { SendMenuItem } from "../../lib/bg-send";

const ITEMS: SendMenuItem[] = [
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
];

test("offeredSendItems: drops only Send and start when it can't run", () => {
  assert.deepEqual(offeredSendItems(ITEMS, true), ITEMS);
  assert.deepEqual(
    offeredSendItems(ITEMS, false).map((i) => i.choice),
    ["send", "queue"]
  );
  assert.deepEqual(offeredSendItems([], false), []);
});

test("sendMenuAvailable: something typed, not editing a queued message", () => {
  assert.equal(sendMenuAvailable({ editing: false, empty: false }), true);
  assert.equal(sendMenuAvailable({ editing: true, empty: false }), false);
  assert.equal(sendMenuAvailable({ editing: false, empty: true }), false);
});

test("initialSendIndex: the highlighted row, else the first", () => {
  assert.equal(initialSendIndex(ITEMS, "sendAndNew"), 1);
  assert.equal(initialSendIndex(ITEMS, "queue"), 2);
  assert.equal(initialSendIndex(ITEMS), 0);
  // Not offered: back to Send
  assert.equal(
    initialSendIndex(offeredSendItems(ITEMS, false), "sendAndNew"),
    0
  );
  assert.equal(initialSendIndex([], "send"), 0);
});

test("stepSendIndex: arrows wrap, Home and End jump, other keys pass", () => {
  assert.equal(stepSendIndex(0, "ArrowDown", 3), 1);
  assert.equal(stepSendIndex(2, "ArrowDown", 3), 0);
  assert.equal(stepSendIndex(0, "ArrowUp", 3), 2);
  assert.equal(stepSendIndex(1, "Home", 3), 0);
  assert.equal(stepSendIndex(0, "End", 3), 2);
  assert.equal(stepSendIndex(0, "Enter", 3), null);
  assert.equal(stepSendIndex(0, "a", 3), null);
  assert.equal(stepSendIndex(0, "ArrowDown", 0), null);
});
