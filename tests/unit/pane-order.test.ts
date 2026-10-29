import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUTTER_ORDER,
  paneCssOrder,
  paneOrder,
  paneOrderStore,
  resetSwap,
  toggleSwap,
} from "../../stores/paneOrder";
import {
  railSessions,
  shortAge,
  sidebarProjects,
} from "../../components/Sidebar/model";

test("toggleSwap flips the pair and back; resetSwap puts it in order", () => {
  paneOrderStore.swapped = false;
  toggleSwap();
  assert.equal(paneOrderStore.swapped, true);
  toggleSwap();
  assert.equal(paneOrderStore.swapped, false);
  toggleSwap();
  resetSwap();
  assert.equal(paneOrderStore.swapped, false);
  resetSwap();
  assert.equal(paneOrderStore.swapped, false);
});

test("paneOrder: only a swapped pair changes places", () => {
  assert.deepEqual(paneOrder(["a", "b"], false), ["a", "b"]);
  assert.deepEqual(paneOrder(["a", "b"], true), ["b", "a"]);
  assert.deepEqual(paneOrder(["a"], true), ["a"]);
  assert.deepEqual(paneOrder(["a", "b", "c"], true), ["a", "b", "c"]);
  // The ids themselves (the React keys) are never reordered
  const ids = ["a", "b"];
  paneOrder(ids, true);
  assert.deepEqual(ids, ["a", "b"]);
});

test("paneCssOrder: the gutter always sits between the two", () => {
  const ids = ["a", "b"];
  assert.equal(paneCssOrder("a", ids, false), 0);
  assert.equal(paneCssOrder("b", ids, false), 2);
  assert.equal(paneCssOrder("a", ids, true), 2);
  assert.equal(paneCssOrder("b", ids, true), 0);
  for (const swapped of [false, true]) {
    const [left, right] = ids
      .map((id) => paneCssOrder(id, ids, swapped))
      .sort((x, y) => x - y);
    assert.ok(left < GUTTER_ORDER && GUTTER_ORDER < right);
  }
});

test("shortAge: now, minutes, hours, days; SQLite times are UTC", () => {
  const now = Date.UTC(2026, 9, 29, 12, 0);
  assert.equal(shortAge(now - 20_000, now), "now");
  assert.equal(shortAge(now - 2 * 60_000, now), "2m");
  assert.equal(shortAge(now - 3 * 3600_000, now), "3h");
  assert.equal(shortAge(now - 2 * 86400_000, now), "2d");
  assert.equal(shortAge("2026-10-29 11:54:00", now), "6m");
  assert.equal(shortAge("2026-10-29T11:55:00Z", now), "5m");
  assert.equal(shortAge("not a date", now), "");
});

const statuses = {
  a: { status: "waiting" as const },
  b: { status: "running" as const },
  c: { status: "idle" as const },
  d: { status: "dead" as const },
  w: { status: "running" as const },
};

test("sidebarProjects: pinned first, user order, no Uncategorized, live counts", () => {
  const projects = [
    { id: "p1", sort_order: 1, is_uncategorized: false },
    { id: "p2", sort_order: 0, is_uncategorized: false },
    { id: "un", sort_order: -1, is_uncategorized: true },
    { id: "p3", sort_order: 2, is_uncategorized: false, pinned: true },
  ];
  const sessions = [
    { id: "a", project_id: "p1", conductor_session_id: null },
    { id: "b", project_id: "p1", conductor_session_id: null },
    { id: "d", project_id: "p1", conductor_session_id: null },
    { id: "w", project_id: "p1", conductor_session_id: "a" },
    { id: "c", project_id: "p2", conductor_session_id: null },
    { id: "x", project_id: "p3", conductor_session_id: null },
  ];
  assert.deepEqual(
    sidebarProjects(projects, sessions, statuses).map((p) => [
      p.project.id,
      p.live,
    ]),
    [
      ["p3", 0],
      ["p2", 1],
      ["p1", 2],
    ]
  );
});

test("railSessions: shown first in place, then needs, working; no idle, workers or dead", () => {
  const s = (
    id: string,
    updated_at: string,
    conductor: string | null = null
  ) => ({
    id,
    updated_at,
    conductor_session_id: conductor,
  });
  const sessions = [
    s("c", "2026-10-29 10:00:00"),
    s("b", "2026-10-29 09:00:00"),
    s("a", "2026-10-29 08:00:00"),
    s("d", "2026-10-29 11:00:00"),
    s("w", "2026-10-29 12:00:00", "a"),
  ];
  assert.deepEqual(
    railSessions(sessions, statuses, []).map((x) => x.id),
    ["a", "b"]
  );
  assert.deepEqual(
    railSessions(sessions, statuses, ["c", "b"]).map((x) => x.id),
    ["c", "b", "a"]
  );
});
