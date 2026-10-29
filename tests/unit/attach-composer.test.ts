import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachFooter,
  attachableStatus,
  filterAttachable,
  formatTokens,
  parseAttached,
  removeAtToken,
  sessionRefs,
  toggleAttached,
} from "../../components/Composer/attach-model";
import { composerExpanded } from "../../components/Composer/queue-model";
import { tokenAtCaret } from "../../components/Composer/text";
import type {
  AttachableSession,
  AttachedSession,
} from "../../lib/session-attach-types";

test("formatTokens: exact under 100, one decimal in k, whole k from 10k", () => {
  assert.equal(formatTokens(0), "0 tokens");
  assert.equal(formatTokens(1), "1 token");
  assert.equal(formatTokens(83), "83 tokens");
  assert.equal(formatTokens(99), "99 tokens");
  assert.equal(formatTokens(100), "0.1k tokens");
  assert.equal(formatTokens(600), "0.6k tokens");
  assert.equal(formatTokens(860), "0.9k tokens");
  assert.equal(formatTokens(999), "1k tokens");
  assert.equal(formatTokens(1000), "1k tokens");
  assert.equal(formatTokens(1200), "1.2k tokens");
  assert.equal(formatTokens(2149), "2.1k tokens");
  assert.equal(formatTokens(9949), "9.9k tokens");
  assert.equal(formatTokens(9950), "10k tokens");
  assert.equal(formatTokens(12_345), "12k tokens");
  assert.equal(formatTokens(-5), "0 tokens");
});

const chip = (id: string, tokens: number | null): AttachedSession => ({
  sessionId: id,
  name: id,
  tokens,
});

test("attachFooter: the mock's line, plural, and the count alone until known", () => {
  assert.equal(attachFooter([]), "");
  assert.equal(attachFooter([chip("a", 1200)]), "Adds 1 session · 1.2k tokens");
  assert.equal(
    attachFooter([chip("a", 1200), chip("b", 850)]),
    "Adds 2 sessions · 2k tokens"
  );
  assert.equal(
    attachFooter([chip("a", 1200), chip("b", null)]),
    "Adds 2 sessions"
  );
});

test("attachableStatus: settled, paused, limited before the live status", () => {
  const now = 1_000_000;
  assert.equal(attachableStatus({}, "waiting", now), "needs_you");
  assert.equal(attachableStatus({}, "running", now), "working");
  assert.equal(attachableStatus({}, "idle", now), "idle");
  assert.equal(attachableStatus({}, "dead", now), "idle");
  assert.equal(attachableStatus({}, undefined, now), "idle");
  assert.equal(
    attachableStatus(
      { limited_at: now - 1000, limited_until: now + 60_000 },
      "idle",
      now
    ),
    "limited"
  );
  assert.equal(
    attachableStatus({ paused_at: now - 5 }, "running", now),
    "paused"
  );
  assert.equal(
    attachableStatus(
      { settled_at: now - 5, paused_at: now - 9 },
      "waiting",
      now
    ),
    "settled"
  );
});

const row = (
  id: string,
  updatedAt: number,
  extra: Partial<AttachableSession> = {}
): AttachableSession => ({
  id,
  name: `Session ${id}`,
  agentType: "claude",
  projectName: null,
  status: "idle",
  tokens: null,
  updatedAt,
  ...extra,
});

test("filterAttachable: not the current one, most recent first, by name or project, capped", () => {
  const rows = [
    row("a", 1, {
      name: "Stack health check",
      projectName: "komodo-ai-operations",
    }),
    row("b", 3, { name: "Deck state line fix", projectName: "agent-os" }),
    row("c", 2, { name: "Signing profiles", projectName: "ios-cert-forge" }),
    row("me", 9),
  ];
  assert.deepEqual(
    filterAttachable(rows, "me", "").map((r) => r.id),
    ["b", "c", "a"]
  );
  assert.deepEqual(
    filterAttachable(rows, "me", "HEALTH").map((r) => r.id),
    ["a"]
  );
  assert.deepEqual(
    filterAttachable(rows, "me", "agent-os").map((r) => r.id),
    ["b"]
  );
  assert.deepEqual(
    filterAttachable(rows, null, "", 2).map((r) => r.id),
    ["me", "b"]
  );
  // Attached ones lead, so their checked row is in view
  assert.deepEqual(
    filterAttachable(rows, "me", "", 30, ["a"]).map((r) => r.id),
    ["a", "b", "c"]
  );
});

test("removeAtToken: the typed @query goes, one space closes up", () => {
  const text = "Use what it found @stack and fix it";
  const t = tokenAtCaret(text, text.indexOf("@stack") + 6)!;
  assert.equal(t.kind, "at");
  assert.deepEqual(removeAtToken(text, t), {
    text: "Use what it found and fix it",
    caret: "Use what it found ".length,
  });
  const end = "Also look at @";
  const t2 = tokenAtCaret(end, end.length)!;
  assert.deepEqual(removeAtToken(end, t2), {
    text: "Also look at ",
    caret: end.length - 1,
  });
  const alone = "@st";
  assert.deepEqual(removeAtToken(alone, tokenAtCaret(alone, 3)!), {
    text: "",
    caret: 0,
  });
});

test("toggleAttached: attach, a second tap detaches, full at the cap", () => {
  const s = row("x", 1, { name: "Stack health check", tokens: 1200 });
  const on = toggleAttached([], s);
  assert.equal(on.change, "attached");
  assert.deepEqual(on.list, [
    { sessionId: "x", name: "Stack health check", tokens: 1200 },
  ]);
  const off = toggleAttached(on.list, s);
  assert.equal(off.change, "detached");
  assert.deepEqual(off.list, []);
  const full = [chip("a", 1), chip("b", 1)];
  const refused = toggleAttached(full, s, 2);
  assert.equal(refused.change, "full");
  assert.equal(refused.list, full);
  // At the cap, an attached one can still come off
  assert.equal(toggleAttached(full, row("a", 1), 2).change, "detached");
});

test("sessionRefs and parseAttached: what's sent and what's restored", () => {
  assert.deepEqual(sessionRefs([chip("a", 5), chip("b", null)]), [
    { sessionId: "a" },
    { sessionId: "b" },
  ]);
  assert.deepEqual(parseAttached(null), []);
  assert.deepEqual(parseAttached("not json"), []);
  assert.deepEqual(parseAttached('{"sessionId":"a"}'), []);
  assert.deepEqual(
    parseAttached(
      JSON.stringify([
        { sessionId: "a", name: "A", tokens: 10 },
        { sessionId: "b", name: "B" },
        { name: "no id" },
      ])
    ),
    [
      { sessionId: "a", name: "A", tokens: 10 },
      { sessionId: "b", name: "B", tokens: null },
    ]
  );
});

test("the card opens for session chips (counted as attachments)", () => {
  const closed = {
    focused: false,
    text: "",
    attachments: 0,
    queued: 0,
    notice: false,
  };
  assert.equal(composerExpanded(closed), false);
  assert.equal(composerExpanded({ ...closed, attachments: 1 }), true);
});
