import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSettle,
  isBusyRefusal,
  notRelaunchedText,
  resumeLabel,
  settledToast,
} from "../../lib/settle-views";
import { isEnded, settledLine } from "../../lib/settle-types";
import { pausedLast, sessionState, withoutPaused } from "../../lib/paused";
import {
  historyTile,
  historyTitle,
} from "../../components/Notifications/history-rows";
import type { NotificationEntry } from "../../lib/push/history";

test("canSettle: only a session whose tmux still runs", () => {
  assert.equal(canSettle({ settled_at: null, paused_at: null }), true);
  assert.equal(canSettle({ settled_at: 5, paused_at: null }), false);
  assert.equal(canSettle({ settled_at: null, paused_at: 5 }), false);
  assert.equal(canSettle(null), false);
  assert.equal(canSettle(undefined), false);
});

test("isBusyRefusal: a 409 busy asks first; other refusals don't", () => {
  assert.equal(isBusyRefusal(409, { error: "x", reason: "busy" }), true);
  assert.equal(
    isBusyRefusal(409, { error: "x", reason: "already_settled" }),
    false
  );
  assert.equal(isBusyRefusal(409, { error: "x", reason: "paused" }), false);
  assert.equal(isBusyRefusal(403, { error: "x", reason: "busy" }), false);
  assert.equal(isBusyRefusal(409, null), false);
});

test("settledToast: the title, and the merged PR under it (N-Settle)", () => {
  assert.deepEqual(
    settledToast("Deck state line fix", {
      pr_number: 106,
      pr_status: "merged",
    }),
    { message: "Deck state line fix settled", description: "PR #106 merged" }
  );
  assert.deepEqual(
    settledToast("Docs", { pr_number: 107, pr_status: "open" }),
    { message: "Docs settled", description: undefined }
  );
  assert.deepEqual(settledToast("Docs", { pr_number: null, pr_status: null }), {
    message: "Docs settled",
    description: undefined,
  });
});

test("resumeLabel: Claude resumes, the others start fresh", () => {
  assert.equal(resumeLabel("claude"), "Resume");
  assert.equal(resumeLabel(null), "Resume");
  assert.equal(resumeLabel("codex"), "Start fresh");
  assert.equal(resumeLabel("gemini"), "Start fresh");
});

test("notRelaunchedText names the agent", () => {
  assert.match(notRelaunchedText("Claude"), /^Claude didn't start again/);
});

test("the settled bar's line, by how it settled", () => {
  const pr = { pr_number: 106, pr_status: "merged" as const };
  assert.equal(
    settledLine({ ...pr, settled_reason: "pr_merged" }),
    "Settled automatically · PR #106 merged"
  );
  assert.equal(
    settledLine({ ...pr, settled_reason: "manual" }),
    "Settled · PR #106 merged"
  );
  assert.equal(
    settledLine({ pr_number: null, pr_status: null, settled_reason: "manual" }),
    "Settled"
  );
});

test("a settled session: ended, its own state word, last in the lists", () => {
  const live = { id: "a", paused_at: null, settled_at: null };
  const settled = { id: "b", paused_at: null, settled_at: 10 };
  const paused = { id: "c", paused_at: 10, settled_at: null };
  // Nothing attaches to it and opening it doesn't relaunch (Pane, page)
  assert.equal(isEnded(settled), true);
  assert.equal(isEnded(live), false);
  for (const status of ["running", "waiting", "idle", "dead", undefined])
    assert.equal(sessionState(settled, status), "settled");
  assert.deepEqual(
    pausedLast([settled, paused, live]).map((s) => s.id),
    ["a", "c", "b"]
  );
  assert.deepEqual(
    withoutPaused([settled, paused, live]).map((s) => s.id),
    ["a"]
  );
});

function entry(over: Partial<NotificationEntry>): NotificationEntry {
  return {
    id: "n1",
    kind: "settled",
    title: "Settled · agent-os · Deck state line fix",
    body: "PR #106 merged",
    projectName: "agent-os",
    at: 0,
    delivered: {},
    read: false,
    ...over,
  };
}

test("history: a settled push is a done tile, '<session> settled'", () => {
  assert.equal(historyTile(entry({})), "done");
  assert.equal(historyTitle(entry({})), "Deck state line fix settled");
  // Whatever word leads the title, the row says settled
  assert.equal(
    historyTitle(entry({ title: "Merged · agent-os · Deck" })),
    "Deck settled"
  );
  assert.equal(historyTitle(entry({ title: "Deck" })), "Deck");
});
