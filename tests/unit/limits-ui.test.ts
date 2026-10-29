import { test } from "node:test";
import assert from "node:assert/strict";
import {
  limitLine,
  limitView,
  limitedSessions,
  nextLimitChange,
  resetIn,
  resetTime,
  resumeErrorText,
  scheduledLine,
  snoozedLine,
  withLimitState,
} from "../../components/Chat/limited-model";
import { sessionState } from "../../lib/agent-state";
import { limitStateOf } from "../../lib/limits/types";

// 13:00 local today; the reset at 14:12 local
const NOW = new Date(2026, 9, 29, 13, 0, 0).getTime();
const UNTIL = new Date(2026, 9, 29, 14, 12, 0).getTime();

const limited = (extra: Record<string, unknown> = {}) => ({
  limited_at: NOW - 60_000,
  limited_until: UNTIL,
  limit_kind: "session",
  resume_policy: null,
  resume_text: null,
  ...extra,
});

test("limitView: card, scheduled, snoozed, none", () => {
  assert.equal(limitView({}, NOW), null);
  assert.equal(limitView(limited(), NOW), "card");
  assert.equal(limitView(limited({ resume_policy: "snooze" }), NOW), "snoozed");
  assert.equal(
    limitView(limited({ resume_policy: "at_reset" }), NOW),
    "scheduled"
  );
  // Past the reset: the card and the snooze go, a scheduled resume stays
  // until the busy edge clears it
  assert.equal(limitView(limited(), UNTIL + 1), null);
  assert.equal(limitView(limited({ resume_policy: "snooze" }), UNTIL), null);
  assert.equal(
    limitView(limited({ resume_policy: "at_reset" }), UNTIL + 60_000),
    "scheduled"
  );
  // Unknown reset: limited for a session window, then not held on
  assert.equal(
    limitView(limited({ limited_until: null }), NOW + 60 * 60_000),
    "card"
  );
  assert.equal(
    limitView(limited({ limited_until: null }), NOW + 6 * 3600e3),
    null
  );
});

test("limitedSessions: only limited ones, oldest limit first", () => {
  const a = { id: "a", ...limited({ limited_at: NOW - 10 }) };
  const b = { id: "b", ...limited({ limited_at: NOW - 500 }) };
  const c = { id: "c", limited_at: null, limited_until: null };
  const d = { id: "d", ...limited({ limited_until: NOW - 1 }) };
  assert.deepEqual(
    limitedSessions([a, c, b, d], NOW).map((s) => s.id),
    ["b", "a"]
  );
});

test("resetIn: hours and minutes, minutes, days, nothing when past", () => {
  assert.equal(resetIn(UNTIL, NOW), "in 1h 12m");
  assert.equal(resetIn(NOW + 5 * 60_000, NOW), "in 5m");
  assert.equal(resetIn(NOW + 30_000, NOW), "in 1m");
  assert.equal(resetIn(NOW + 2 * 3600_000, NOW), "in 2h");
  assert.equal(resetIn(NOW + 50 * 3600_000, NOW), "in 2d");
  assert.equal(resetIn(NOW - 1, NOW), "");
  assert.equal(resetIn(null, NOW), "");
});

test("the card's and rows' lines", () => {
  const state = limitStateOf(limited(), NOW);
  assert.equal(resetTime(UNTIL, NOW), "2:12 pm");
  assert.equal(
    limitLine(state, "Claude", NOW),
    "Claude hit the session limit · resets 2:12 pm"
  );
  assert.equal(
    limitLine(
      limitStateOf(limited({ limited_until: null, limit_kind: "week" })),
      "Claude"
    ),
    "Claude hit the weekly limit"
  );
  assert.equal(
    limitLine(
      limitStateOf(limited({ limit_kind: "bogus" }), NOW),
      "Claude",
      NOW
    ),
    "Claude hit the usage limit · resets 2:12 pm"
  );
  assert.equal(scheduledLine(state, NOW), "Will resume at 2:12 pm");
  assert.equal(scheduledLine(state, UNTIL), "Resuming when it's ready");
  assert.equal(
    scheduledLine(limitStateOf(limited({ limited_until: null })), NOW),
    "Will resume at the reset"
  );
  assert.equal(snoozedLine(state, NOW), "Snoozed · resets 2:12 pm");
});

test("withLimitState writes a resume result back onto the row", () => {
  const row = { id: "s", name: "x", ...limited() };
  const scheduled = withLimitState(row, {
    ...limitStateOf(row, NOW),
    policy: "at_reset",
    resumeText: "continue",
  });
  assert.equal(scheduled.resume_policy, "at_reset");
  assert.equal(scheduled.resume_text, "continue");
  assert.equal(scheduled.id, "s");
  assert.equal(limitView(scheduled, NOW), "scheduled");

  const cleared = withLimitState(row, limitStateOf({}, NOW));
  assert.equal(cleared.limited_at, null);
  assert.equal(cleared.limit_kind, null);
  assert.equal(limitView(cleared, NOW), null);
});

test("nextLimitChange: the earliest reset still ahead", () => {
  assert.equal(nextLimitChange([], NOW), null);
  assert.equal(nextLimitChange([null, undefined, NOW - 5], NOW), null);
  assert.equal(nextLimitChange([UNTIL, NOW + 10, null], NOW), NOW + 10);
});

test("resumeErrorText", () => {
  assert.match(resumeErrorText(501, null), /isn't available yet/);
  assert.equal(resumeErrorText(404, {}), "That session has gone");
  assert.equal(resumeErrorText(400, { error: "Bad when" }), "Bad when");
  assert.equal(
    resumeErrorText(403, { error: "user_only", reason: "no_proof" }),
    "Reload to confirm it's you"
  );
  assert.equal(resumeErrorText(500, null), "Couldn't change the resume (500)");
});

test("sessionState: limited wins until the reset, then the status", () => {
  assert.equal(sessionState(limited(), "waiting", NOW), "limited");
  assert.equal(sessionState(limited(), "running", UNTIL + 1), "work");
  assert.equal(sessionState({}, "waiting", NOW), "needs");
  assert.equal(sessionState({}, undefined, NOW), "idle");
});
