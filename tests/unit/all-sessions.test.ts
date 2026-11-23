import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allSummary,
  allTiles,
  filterTiles,
  tileCounts,
  tileLines,
  type TileSource,
} from "../../lib/all-sessions";
import type { Session } from "../../lib/db";

const session = (id: string, more: Partial<Session> = {}): Session =>
  ({
    id,
    name: id,
    updated_at: "2026-11-23 10:00:00",
    project_id: null,
    conductor_session_id: null,
    ...more,
  }) as Session;

const here: TileSource = {
  tag: null,
  sessions: [
    session("idle-old", { updated_at: "2026-11-22 09:00:00" }),
    session("works", { project_id: "p1" }),
    session("asks", { project_id: "p1", updated_at: "2026-11-23 08:00:00" }),
    session("worker", { conductor_session_id: "works" }),
    session("loose", { project_id: "u" }),
  ],
  statuses: {
    works: { status: "running", lastLine: "Compiling" },
    asks: { status: "waiting" },
    loose: { status: "idle" },
  },
  projects: [
    { id: "p1", name: "fusionha-ios" },
    { id: "u", name: "Uncategorized", is_uncategorized: 1 },
  ],
};
const mac: TileSource = {
  tag: { target: "m_1", name: "Mac Studio", kind: "mac" },
  sessions: [session("asks"), session("builds")],
  statuses: {
    asks: { status: "waiting" },
    builds: { status: "running" },
  },
  projects: [],
};

test("tiles: what needs you first, then what works, newest first", () => {
  const tiles = allTiles([here, mac]);
  assert.deepEqual(
    tiles.map((t) => `${t.tag?.name ?? "here"}/${t.session.id}/${t.state}`),
    [
      "Mac Studio/asks/needs",
      "here/asks/needs",
      "here/works/working",
      "Mac Studio/builds/working",
      "here/loose/idle",
      "here/idle-old/idle",
    ]
  );
  // A working tile carries its lines; an idle pane's old screen is left out
  assert.deepEqual(tiles[2].lines, ["Compiling"]);
  assert.deepEqual(
    allTiles([
      { ...here, statuses: { loose: { status: "idle", lastLine: "Done" } } },
    ]).find((t) => t.session.id === "loose")?.lines,
    []
  );
  // A conductor's worker is not a tile of its own
  assert.ok(!tiles.some((t) => t.session.id === "worker"));
  // The same id on two machines is two tiles
  assert.equal(new Set(tiles.map((t) => t.key)).size, tiles.length);
});

test("tiles: the project by name, never Uncategorized", () => {
  const tiles = allTiles([here]);
  assert.equal(
    tiles.find((t) => t.session.id === "works")?.project,
    "fusionha-ios"
  );
  assert.equal(tiles.find((t) => t.session.id === "loose")?.project, undefined);
});

test("tiles: filtered by state and by machine", () => {
  const tiles = allTiles([here, mac]);
  assert.equal(filterTiles(tiles, "all", null).length, 6);
  assert.equal(filterTiles(tiles, "needs", null).length, 2);
  assert.equal(filterTiles(tiles, "working", "m_1").length, 1);
  assert.equal(filterTiles(tiles, "all", "").length, 4);
  assert.deepEqual(tileCounts(tiles), {
    all: 6,
    needs: 2,
    working: 2,
    machines: 2,
  });
});

test("tiles: the last lines, without Claude's frame", () => {
  assert.deepEqual(
    tileLines({
      recentLines: [
        "Reading files",
        "Compiling FeatherKit (212 of 340)",
        "Linking FeatherCore.framework",
        "Signing with the team profile",
        "──────────────",
        "> ",
        "  ? for shortcuts",
      ],
    }),
    [
      "Compiling FeatherKit (212 of 340)",
      "Linking FeatherCore.framework",
      "Signing with the team profile",
    ]
  );
  assert.deepEqual(tileLines({ lastLine: " npx tsc --noEmit " }), [
    "npx tsc --noEmit",
  ]);
  assert.deepEqual(tileLines({ lastLine: "? for shortcuts" }), []);
  assert.deepEqual(
    tileLines({
      recentLines: [
        " ▐▛███▜▌   Claude Code v2.1.330",
        "▝▜█████▛▘  Fable 5.2 · Claude Max",
        "  ▘▘ ▝▝    ~/AgentOS/app",
      ],
    }),
    []
  );
  assert.deepEqual(tileLines(undefined), []);
});

test("the page's line", () => {
  assert.equal(allSummary(0, 1), "No sessions");
  assert.equal(allSummary(1, 1), "1 session");
  assert.equal(allSummary(4, 1), "4 sessions");
  assert.equal(allSummary(5, 2), "5 on 2 machines");
});
