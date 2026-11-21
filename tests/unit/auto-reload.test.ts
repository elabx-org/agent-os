import { test } from "node:test";
import assert from "node:assert/strict";
import { canReloadNow, type PageMoment } from "../../lib/auto-reload";

const at = (over: Partial<PageMoment>): PageMoment => ({
  hidden: false,
  draft: false,
  overlay: false,
  typing: false,
  idleMs: 60_000,
  ...over,
});

test("the page reloads itself only when nothing would be lost", () => {
  assert.equal(canReloadNow(at({})), true);
  assert.equal(
    canReloadNow(at({ hidden: true, idleMs: 0, typing: true })),
    true
  );
  // Text typed anywhere, or something open on top: never, even in the background
  assert.equal(canReloadNow(at({ draft: true })), false);
  assert.equal(canReloadNow(at({ draft: true, hidden: true })), false);
  assert.equal(canReloadNow(at({ overlay: true, hidden: true })), false);
  // In front of the user: not mid-tap, and a longer pause with the cursor in a field
  assert.equal(canReloadNow(at({ typing: true, idleMs: 10_000 })), false);
  assert.equal(canReloadNow(at({ typing: true, idleMs: 25_000 })), true);
  assert.equal(canReloadNow(at({ idleMs: 1000 })), false);
});
