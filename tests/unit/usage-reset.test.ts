import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReset } from "../../lib/usage-reset";

// Local times, so the tests hold in any time zone. Wed 14 Oct 2026, 1:00 pm
const now = new Date(2026, 9, 14, 13, 0);
const at = (...parts: [number, number, number, number, number]) =>
  new Date(...parts).toISOString();

test("formatReset: later the same day is the time", () => {
  assert.equal(formatReset(at(2026, 9, 14, 16, 10), { now }), "4:10 pm");
  assert.equal(formatReset(at(2026, 9, 14, 13, 5), { now }), "1:05 pm");
});

test("formatReset: the next day within 24 hours is the time", () => {
  assert.equal(formatReset(at(2026, 9, 15, 9, 0), { now }), "9:00 am");
  assert.equal(formatReset(at(2026, 9, 15, 0, 30), { now }), "12:30 am");
  assert.equal(formatReset(at(2026, 9, 15, 12, 59), { now }), "12:59 pm");
});

test("formatReset: style doesn't change a time", () => {
  assert.equal(
    formatReset(at(2026, 9, 14, 16, 10), { now, style: "long" }),
    "4:10 pm"
  );
});

test("formatReset: 24 hours or more is the weekday", () => {
  assert.equal(formatReset(at(2026, 9, 15, 13, 0), { now }), "Thu");
  assert.equal(formatReset(at(2026, 9, 19, 9, 0), { now }), "Mon");
  assert.equal(
    formatReset(at(2026, 9, 19, 9, 0), { now, style: "long" }),
    "Monday"
  );
  assert.equal(
    formatReset(at(2026, 9, 18, 9, 0), { now, style: "short" }),
    "Sun"
  );
});

test("formatReset: no time or a bad one is empty", () => {
  assert.equal(formatReset(null, { now }), "");
  assert.equal(formatReset(undefined, { now }), "");
  assert.equal(formatReset("", { now }), "");
  assert.equal(formatReset("not a date", { now }), "");
});
