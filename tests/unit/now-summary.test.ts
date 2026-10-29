import { test } from "node:test";
import assert from "node:assert/strict";
import { nowSubline } from "../../components/MissionControl/now-summary";

const zero = { needs: 0, working: 0, limited: 0, settledToday: 0 };

test("nowSubline: all zero is all quiet", () => {
  assert.equal(nowSubline(zero), "All quiet");
});

test("nowSubline: needs you is singular for one", () => {
  assert.equal(nowSubline({ ...zero, needs: 1 }), "1 needs you");
  assert.equal(nowSubline({ ...zero, needs: 2 }), "2 need you");
});

test("nowSubline: the mock's line", () => {
  assert.equal(
    nowSubline({ ...zero, needs: 2, working: 2 }),
    "2 need you · 2 working"
  );
});

test("nowSubline: zero parts are left out", () => {
  assert.equal(nowSubline({ ...zero, working: 3 }), "3 working");
  assert.equal(nowSubline({ ...zero, limited: 1 }), "1 limited");
  assert.equal(nowSubline({ ...zero, settledToday: 4 }), "4 settled today");
  assert.equal(
    nowSubline({ ...zero, needs: 1, limited: 2 }),
    "1 needs you · 2 limited"
  );
  assert.equal(
    nowSubline({ ...zero, working: 1, settledToday: 1 }),
    "1 working · 1 settled today"
  );
});

test("nowSubline: every part, in order", () => {
  assert.equal(
    nowSubline({ needs: 3, working: 1, limited: 1, settledToday: 2 }),
    "3 need you · 1 working · 1 limited · 2 settled today"
  );
});

test("nowSubline: every combination joins the non-zero parts", () => {
  const words = [
    (n: number) => `${n} ${n === 1 ? "needs" : "need"} you`,
    (n: number) => `${n} working`,
    (n: number) => `${n} limited`,
    (n: number) => `${n} settled today`,
  ];
  for (let mask = 0; mask < 16; mask++) {
    const n = [1, 2, 3, 4].map((v, i) => (mask & (1 << i) ? v : 0));
    const expected = n.flatMap((v, i) => (v ? [words[i](v)] : [])).join(" · ");
    assert.equal(
      nowSubline({
        needs: n[0],
        working: n[1],
        limited: n[2],
        settledToday: n[3],
      }),
      expected || "All quiet"
    );
  }
});
