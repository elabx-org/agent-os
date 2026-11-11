import { test } from "node:test";
import assert from "node:assert/strict";
import { clipboardKey, type ClipboardKeyInput } from "../../lib/clipboard-keys";

const base: ClipboardKeyInput = {
  key: "c",
  ctrl: false,
  meta: false,
  shift: false,
  alt: false,
  mac: false,
  selected: false,
  dragged: false,
};
const k = (o: Partial<ClipboardKeyInput>) => clipboardKey({ ...base, ...o });

test("Windows: Ctrl+V pastes, Ctrl+C copies a selection, else interrupts", () => {
  assert.equal(k({ key: "v", ctrl: true }), "paste");
  assert.equal(k({ ctrl: true, selected: true }), "copy");
  assert.equal(k({ ctrl: true, dragged: true }), "copyTmux");
  assert.equal(k({ ctrl: true }), null);
  assert.equal(k({ key: "C", ctrl: true, shift: true }), "copyTmux");
  assert.equal(k({ key: "V", ctrl: true, shift: true }), "paste");
  assert.equal(k({ key: "v", ctrl: true, alt: true }), null);
  assert.equal(k({ key: "x", ctrl: true }), null);
});

test("Mac: ⌘ copies and pastes, Ctrl stays with the terminal", () => {
  assert.equal(k({ mac: true, key: "v", meta: true }), "paste");
  assert.equal(k({ mac: true, meta: true, selected: true }), "copy");
  assert.equal(k({ mac: true, meta: true }), "copyTmux");
  assert.equal(k({ mac: true, key: "v", ctrl: true }), null);
  assert.equal(k({ mac: true, ctrl: true, selected: true }), null);
});
