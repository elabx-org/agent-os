import { test } from "node:test";
import assert from "node:assert/strict";
import { canSendTerminalSize } from "../../lib/terminal-size";

const shown = { offsetParent: {} as Element, clientWidth: 466 };
const hidden = { offsetParent: null, clientWidth: 0 };

test("only a terminal on screen at a usable size resizes tmux", () => {
  assert.equal(canSendTerminalSize(shown, 66, 28), true);
  assert.equal(canSendTerminalSize(shown, 66, 5), true);
  // A hidden tab's terminal, at any size
  assert.equal(canSendTerminalSize(hidden, 66, 28), false);
  assert.equal(canSendTerminalSize(undefined, 66, 28), false);
  // Squeezed mid-layout: the 14x5 that shrank sessions to a corner of dots
  assert.equal(canSendTerminalSize(shown, 14, 5), false);
  assert.equal(canSendTerminalSize(shown, 66, 1), false);
});
