import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterReattach,
  seeStarted,
  REATTACH_TRIES,
  type Attached,
} from "../../lib/reattach";

const S = "60a93467-abe3-4ce6-ab39-f5934bf1024c";

test("a tab first sees its session: nothing to do", () => {
  const { next, reattach } = seeStarted(undefined, S, 100);
  assert.equal(reattach, false);
  assert.deepEqual(next, { sessionId: S, started: 100, tries: 0 });
});

test("the same tmux session: nothing to do", () => {
  const known: Attached = { sessionId: S, started: 100, tries: 0 };
  assert.equal(seeStarted(known, S, 100).reattach, false);
});

test("restarted from elsewhere: the tab attaches again", () => {
  const known: Attached = { sessionId: S, started: 100, tries: 0 };
  // Ended: it keeps what it was attached to
  const gone = seeStarted(known, S, undefined);
  assert.equal(gone.reattach, false);
  assert.deepEqual(gone.next, known);
  // Back, as a new tmux session
  const back = seeStarted(gone.next, S, 250);
  assert.equal(back.reattach, true);
  assert.deepEqual(afterReattach(back.next, true, 250), {
    sessionId: S,
    started: 250,
    tries: 0,
  });
});

test("never seen running: the tab's own attach starts it", () => {
  const first = seeStarted(undefined, S, undefined);
  assert.equal(first.reattach, false);
  const now = seeStarted(first.next, S, 300);
  assert.equal(now.reattach, false);
  assert.equal(now.next.started, 300);
});

test("another session in the tab starts over", () => {
  const known: Attached = { sessionId: S, started: 100, tries: 2 };
  const { next, reattach } = seeStarted(known, "other", 900);
  assert.equal(reattach, false);
  assert.deepEqual(next, { sessionId: "other", started: 900, tries: 0 });
});

test("an attach that isn't typed is tried a few times, then let be", () => {
  let known: Attached = { sessionId: S, started: 100, tries: 0 };
  for (let i = 1; i < REATTACH_TRIES; i++) {
    known = afterReattach(known, false, 250);
    assert.equal(known.started, 100);
    assert.equal(known.tries, i);
    assert.equal(seeStarted(known, S, 250).reattach, true);
  }
  // The tab's own attach already shows it (this page restarted it)
  known = afterReattach(known, false, 250);
  assert.deepEqual(known, { sessionId: S, started: 250, tries: 0 });
  assert.equal(seeStarted(known, S, 250).reattach, false);
});
