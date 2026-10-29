import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  limitFromStatus,
  limitFromUsage,
  parseLimitScreen,
  parseReset,
  resolveUntil,
  usageResetFor,
} from "../../lib/limits/detect";
import type { UsageResponse } from "../../lib/claude-usage";

// Times without a zone are local: pin it so the tests hold anywhere
process.env.TZ = "UTC";

const screen = (name: string) =>
  fs
    .readFileSync(path.join(__dirname, "fixtures", "limits", name), "utf8")
    .replace(/\n$/, "")
    .split("\n");

// Thu 29 Oct 2026, 1:00 pm UTC
const now = new Date(Date.UTC(2026, 9, 29, 13, 0));
const utc = (d: number, h: number, m = 0, month = 9) =>
  Date.UTC(2026, month, d, h, m);

test("parseLimitScreen: Claude's session limit with its reset", () => {
  assert.deepEqual(parseLimitScreen(screen("session-limit.txt"), now), {
    kind: "session",
    until: utc(29, 15, 40),
  });
});

test("parseLimitScreen: the plain limit message names no kind", () => {
  assert.deepEqual(parseLimitScreen(screen("fake-limit.txt"), now), {
    kind: "unknown",
    until: utc(29, 15, 40),
  });
});

test("parseLimitScreen: the footer's 5-hour notice", () => {
  assert.deepEqual(parseLimitScreen(screen("five-hour-footer.txt"), now), {
    kind: "session",
    until: utc(29, 15),
  });
});

test("parseLimitScreen: weekly limit with a date", () => {
  assert.deepEqual(parseLimitScreen(screen("weekly.txt"), now), {
    kind: "week",
    until: utc(2, 18, 0, 10),
  });
});

test("parseLimitScreen: Opus limit on a weekday in another zone", () => {
  // Mon 2 Nov 2026, 9 am in New York (EST, UTC-5 after the DST change)
  assert.deepEqual(parseLimitScreen(screen("opus.txt"), now), {
    kind: "opus",
    until: utc(2, 14, 0, 10),
  });
});

test("parseLimitScreen: a wrapped message is read whole", () => {
  // 12am has passed today: the next one
  assert.deepEqual(parseLimitScreen(screen("wrapped.txt"), now), {
    kind: "session",
    until: utc(30, 0),
  });
});

test("parseLimitScreen: not an old limit, a warning, the input or another limit", () => {
  for (const name of [
    "stale.txt",
    "approaching.txt",
    "typed.txt",
    "other-limit.txt",
  ]) {
    assert.equal(parseLimitScreen(screen(name), now), null, name);
  }
  assert.equal(parseLimitScreen([], now), null);
});

test("parseLimitScreen: the older wording and no reset", () => {
  assert.deepEqual(
    parseLimitScreen(
      [
        "Claude usage limit reached. Your limit will reset at 3pm (America/New_York).",
      ],
      now
    ),
    // New York is still on EDT (UTC-4) on 29 Oct
    { kind: "unknown", until: utc(29, 19) }
  );
  assert.deepEqual(parseLimitScreen(["You've hit your Sonnet limit"], now), {
    kind: "sonnet",
    until: null,
  });
});

test("parseReset: time forms, rolling past times to tomorrow", () => {
  assert.equal(parseReset("3:40pm", now), utc(29, 15, 40));
  assert.equal(parseReset("3:40 pm", now), utc(29, 15, 40));
  assert.equal(parseReset("18:00", now), utc(29, 18));
  assert.equal(parseReset("12pm", now), utc(30, 12));
  assert.equal(parseReset("1pm", now), utc(30, 13));
  assert.equal(parseReset("12am (UTC)", now), utc(30, 0));
  assert.equal(parseReset("10pm (Europe/London)", now), utc(29, 22));
  assert.equal(parseReset("tomorrow 9am", now), utc(30, 9));
  assert.equal(parseReset("Thu 2pm", now), utc(29, 14));
  assert.equal(parseReset("Thursday at 9am", now), utc(5, 9, 0, 10));
  assert.equal(parseReset("2026-11-02 18:00 UTC", now), utc(2, 18, 0, 10));
  assert.equal(parseReset("Jan 3, 10am", now), Date.UTC(2027, 0, 3, 10));
  assert.equal(parseReset("in 2h 15m", now), now.getTime() + 135 * 60_000);
  assert.equal(parseReset("soon", now), null);
  assert.equal(parseReset("13pm", now), null);
});

test("parseReset: a bad zone falls back to local time", () => {
  assert.equal(parseReset("3pm (Not/AZone)", now), utc(29, 15));
});

test("limitFromStatus: a full window, its reset in ms", () => {
  assert.equal(limitFromStatus(null), null);
  assert.equal(
    limitFromStatus({
      five_hour: { used_percentage: 99, resets_at: 1_800_000_000 },
    }),
    null
  );
  assert.deepEqual(
    limitFromStatus({
      five_hour: { used_percentage: 100, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 40, resets_at: 1_800_500_000 },
    }),
    { kind: "session", until: 1_800_000_000_000 }
  );
  assert.deepEqual(
    limitFromStatus({ seven_day_opus: { used_percentage: 101 } }),
    { kind: "opus", until: null }
  );
});

test("limitFromStatus: of two full windows, the later reset binds", () => {
  assert.deepEqual(
    limitFromStatus({
      five_hour: { used_percentage: 100, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 100, resets_at: 1_800_500_000 },
    }),
    { kind: "week", until: 1_800_500_000_000 }
  );
});

const usage: UsageResponse = {
  five_hour: { utilization: 100, resets_at: "2026-10-29T15:40:00Z" },
  seven_day: { utilization: 61, resets_at: "2026-11-02T18:00:00Z" },
  seven_day_sonnet: null,
  seven_day_opus: { utilization: 20, resets_at: "2026-10-01T00:00:00Z" },
  extra_usage: {
    is_enabled: false,
    utilization: null,
    used_credits: null,
    monthly_limit: null,
  },
  plan: "Max 5x",
};

test("usageResetFor: the kind's reset while it is ahead", () => {
  const t = now.getTime();
  assert.equal(usageResetFor(usage, "session", t), utc(29, 15, 40));
  assert.equal(usageResetFor(usage, "week", t), utc(2, 18, 0, 10));
  assert.equal(usageResetFor(usage, "opus", t), null);
  assert.equal(usageResetFor(usage, "sonnet", t), null);
  assert.equal(usageResetFor(usage, "unknown", t), null);
  assert.equal(usageResetFor(null, "session", t), null);
});

test("limitFromUsage: the full window names the kind", () => {
  assert.deepEqual(limitFromUsage(usage, now.getTime()), {
    kind: "session",
    until: utc(29, 15, 40),
  });
  assert.equal(limitFromUsage(usage, utc(29, 16)), null);
});

test("resolveUntil: status, then usage, then screen", () => {
  assert.equal(resolveUntil({ status: 1, usage: 2, screen: 3 }), 1);
  assert.equal(resolveUntil({ status: null, usage: 2, screen: 3 }), 2);
  assert.equal(resolveUntil({ screen: 3 }), 3);
  assert.equal(resolveUntil({}), null);
  assert.equal(resolveUntil({ status: Number.NaN, usage: 0 }), null);
});
