import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRUST_SCREEN,
  answerTrust,
  keysToYes,
  type TrustPane,
} from "../../lib/trust-screen";

// Claude Code 2.1.330: the cursor starts on No
const NO_FIRST = [
  " Accessing workspace:",
  " /Users/someone/AgentOS/.jobs/work/harbour-291846b69235",
  " Quick safety check: Is this a project you created or one you trust? (Like your",
  "own code, a well-known open source project, or work from your team). If not, take",
  " a moment to review what's in this folder first.",
  " Claude Code'll be able to read, edit, and execute files here.",
  " Security guide",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  " Enter to confirm · Esc to cancel",
].join("\n");

// Older versions: numbered, the cursor on Yes
const YES_FIRST = [
  "│ Do you trust the files in this folder?                 │",
  "│ /home/someone/code/harbour                             │",
  "│ ❯ 1. Yes, proceed                                      │",
  "│   2. No, exit                                          │",
  "│ Enter to confirm · Esc to exit                         │",
].join("\n");

const moved = (screen: string) =>
  screen
    .replace(" ❯ No, exit", "   No, exit")
    .replace("   Yes, I trust this folder", " ❯ Yes, I trust this folder");

/** A pane that moves its cursor on Down as Claude's list does */
function pane(start: string, onDown = moved) {
  let screen = start;
  const pressed: string[] = [];
  const p: TrustPane = {
    read: async () => screen,
    press: async (key) => {
      pressed.push(key);
      if (key === "Down") screen = onDown(screen);
    },
    wait: async () => {},
  };
  return { p, pressed };
}

test("trust screen: both layouts are recognised", () => {
  assert.ok(TRUST_SCREEN.test(NO_FIRST));
  assert.ok(TRUST_SCREEN.test(YES_FIRST));
});

test("trust screen: the keys that reach Yes depend on where the cursor is", () => {
  assert.deepEqual(keysToYes(NO_FIRST), ["Down"]);
  assert.deepEqual(keysToYes(moved(NO_FIRST)), []);
  assert.deepEqual(keysToYes(YES_FIRST), []);
  assert.deepEqual(
    keysToYes(["   Yes, I trust this folder", " ❯ No, exit"].join("\n")),
    ["Up"]
  );
  // No cursor, or no answers: not guessed at
  assert.equal(keysToYes("   Yes, proceed\n   No, exit"), null);
  assert.equal(
    keysToYes("Is this a project you created or one you trust?"),
    null
  );
});

test("trust screen: with the cursor on No it moves to Yes before Enter", async () => {
  const { p, pressed } = pane(NO_FIRST);
  assert.equal(await answerTrust(p), true);
  assert.deepEqual(pressed, ["Down", "Enter"]);
});

test("trust screen: with the cursor on Yes it is Enter alone", async () => {
  const { p, pressed } = pane(YES_FIRST);
  assert.equal(await answerTrust(p), true);
  assert.deepEqual(pressed, ["Enter"]);
});

test("trust screen: Enter is never sent unless the cursor is seen on Yes", async () => {
  // The cursor didn't move
  const stuck = pane(NO_FIRST, (s) => s);
  assert.equal(await answerTrust(stuck.p), false);
  assert.deepEqual(stuck.pressed, ["Down"]);
  // The screen went away meanwhile
  const gone = pane(NO_FIRST, () => "> ");
  assert.equal(await answerTrust(gone.p), false);
  assert.ok(!gone.pressed.includes("Enter"));
  // Not the trust screen at all
  const other = pane("❯ 1. Yes\n  2. No");
  assert.equal(await answerTrust(other.p), false);
  assert.deepEqual(other.pressed, []);
});
