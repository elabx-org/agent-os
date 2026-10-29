import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMergedPrs } from "../../lib/merged-today";

// Local times, so the test holds in any time zone
const today = new Date(2026, 9, 29, 15, 0);
const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour, 30).toISOString();

const pr = (number: number, mergedAt: string) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  mergedAt,
});

test("parseMergedPrs: only today's, in merge order", () => {
  const json = JSON.stringify([
    pr(105, at(28, 23)),
    pr(106, at(29, 9)),
    pr(107, at(29, 14)),
    pr(104, at(29, 0)),
  ]);
  assert.deepEqual(
    parseMergedPrs(json, today).map((p) => p.number),
    [104, 106, 107]
  );
});

test("parseMergedPrs: keeps the fields as gh gives them", () => {
  const one = pr(106, at(29, 9));
  assert.deepEqual(parseMergedPrs(JSON.stringify([one]), today), [one]);
});

test("parseMergedPrs: junk is an empty list", () => {
  for (const json of ["", "not json", "{}", "null", '"x"', "42"])
    assert.deepEqual(parseMergedPrs(json, today), []);
});

test("parseMergedPrs: skips entries missing a field", () => {
  const json = JSON.stringify([
    null,
    "x",
    { number: "106", title: "t", url: "u", mergedAt: at(29, 9) },
    { number: 107, title: "t", url: "u" },
    { number: 108, title: "t", url: "u", mergedAt: "yesterday-ish" },
    pr(109, at(29, 10)),
  ]);
  assert.deepEqual(
    parseMergedPrs(json, today).map((p) => p.number),
    [109]
  );
});
