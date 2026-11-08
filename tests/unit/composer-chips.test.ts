import { test } from "node:test";
import assert from "node:assert/strict";
import { collapse, keepChipsWhole } from "../../components/Composer/text";

const A = "/tmp/agent-os-screenshots/1794161028013-3123cb85-IMG_7896.png";
const B = "/tmp/agent-os-screenshots/1794161027875-b55fff2b-IMG_7898.jpeg";
const sizes = (p: string) => (p === A ? 5634667 : 329039);
const shown = (typed: string) => collapse(`${A} ${B} ${typed}`, [], sizes);

test("keepChipsWhole: typing after the pills is left alone", () => {
  const { display, chips } = shown("why isnt");
  assert.equal(keepChipsWhole(display, `${display}x`, chips), null);
});

test("keepChipsWhole: a replacement reaching into a pill's end (iOS autocorrect) keeps the pill and the text", () => {
  const { display, chips } = shown("why isnt");
  const pill = chips[1];
  // iOS swaps the pill's last characters with plain spaces as part of a word
  const tail = display.slice(pill.end - 5, pill.end);
  const next =
    display.slice(0, pill.end - 5) +
    tail.replace(/ /g, " ") +
    display.slice(pill.end);
  const fixed = keepChipsWhole(display, next, chips);
  assert.ok(fixed);
  assert.equal(
    fixed.display,
    display,
    "the pill and the text stay as they were"
  );
  const end = keepChipsWhole(display, next, chips, next.length);
  assert.equal(end?.caret, display.length, "the caret stays at the end");
});

test("keepChipsWhole: a replacement across a pill's end changes only the text after it", () => {
  const { display, chips } = shown("whyy isnt");
  const pill = chips[1];
  const at = display.indexOf("whyy");
  // iOS replaces "KB··×␠whyy" (from inside the pill) with "KB  × why"
  const next =
    display.slice(0, pill.end - 5) + "KB  × why" + display.slice(at + 4);
  // The browser's caret: after "why"
  const caretIn = next.indexOf("why") + 3;
  const fixed = keepChipsWhole(display, next, chips, caretIn);
  assert.ok(fixed);
  assert.equal(fixed.display, display.replace("whyy", "why"));
  assert.equal(fixed.caret, at + 3);
});

test("keepChipsWhole: backspace into a pill still takes the whole pill", () => {
  const { display, chips } = shown("");
  const pill = chips[1];
  const next = display.slice(0, pill.end - 1) + display.slice(pill.end);
  const fixed = keepChipsWhole(display, next, chips);
  assert.ok(fixed);
  assert.equal(
    fixed.display,
    display.slice(0, pill.start) + display.slice(pill.end)
  );
  assert.equal(fixed.caret, pill.start);
});

test("keepChipsWhole: typing inside a pill goes after it", () => {
  const { display, chips } = shown("");
  const pill = chips[0];
  const mid = pill.start + 6;
  const next = display.slice(0, mid) + "x" + display.slice(mid);
  const fixed = keepChipsWhole(display, next, chips);
  assert.ok(fixed);
  assert.equal(
    fixed.display,
    display.slice(0, pill.end) + "x" + display.slice(pill.end)
  );
  assert.equal(fixed.caret, pill.end + 1);
});
