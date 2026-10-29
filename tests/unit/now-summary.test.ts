import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nowSubline,
  sortQuietSessions,
} from "../../components/MissionControl/now-summary";

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
    "3 need you · 1 limited · 1 working · 2 settled today"
  );
});

test("nowSubline: every combination joins the non-zero parts", () => {
  const words = [
    (n: number) => `${n} ${n === 1 ? "needs" : "need"} you`,
    (n: number) => `${n} limited`,
    (n: number) => `${n} working`,
    (n: number) => `${n} settled today`,
  ];
  for (let mask = 0; mask < 16; mask++) {
    // In line order: needs, limited, working, settled
    const n = [1, 3, 2, 4].map((v, i) => (mask & (1 << i) ? v : 0));
    const expected = n.flatMap((v, i) => (v ? [words[i](v)] : [])).join(" · ");
    assert.equal(
      nowSubline({
        needs: n[0],
        limited: n[1],
        working: n[2],
        settledToday: n[3],
      }),
      expected || "All quiet"
    );
  }
});

test("sortQuietSessions: live first, paused (handed off) last, each latest first", () => {
  const s = (
    id: string,
    updated_at: string,
    paused_at: number | null = null
  ) => ({ id, updated_at, paused_at });
  const sorted = sortQuietSessions([
    s("old", "2026-10-01 10:00:00"),
    s("paused-new", "2026-10-29 10:00:00", 1),
    s("new", "2026-10-28 10:00:00"),
    s("paused-old", "2026-10-02 10:00:00", 2),
  ]);
  assert.deepEqual(
    sorted.map((x) => x.id),
    ["new", "old", "paused-new", "paused-old"]
  );
});

test("sortQuietSessions: leaves its input alone", () => {
  const input = [
    { id: "a", updated_at: "2026-10-01 10:00:00", paused_at: 5 },
    { id: "b", updated_at: "2026-10-01 09:00:00", paused_at: null },
  ];
  sortQuietSessions(input);
  assert.deepEqual(
    input.map((x) => x.id),
    ["a", "b"]
  );
});
