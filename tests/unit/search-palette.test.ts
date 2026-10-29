import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../../lib/db";
import type { SearchResponse } from "../../lib/search/types";
import {
  highlightParts,
  moveSelection,
  nextFilter,
  paletteRows,
  paletteSections,
  recentSessionHits,
  resultsCurrent,
  resultKey,
} from "../../components/Search/palette-model";
import { searchQueryString } from "../../data/search/queries";

const session = (id: string, name: string, updated: string, extra = {}) =>
  ({
    id,
    name,
    updated_at: updated,
    agent_type: "claude",
    project_id: "p1",
    branch_name: "main",
    ...extra,
  }) as unknown as Session;

const response: SearchResponse = {
  query: "undo turn",
  sessions: [
    {
      id: "s1",
      name: "Undo turn checkpoints",
      agentType: "claude",
      projectId: "p1",
      projectName: "agent-os",
      branch: "main",
      updatedAt: "2026-10-28T10:00:00Z",
      nameRanges: [[0, 9]],
    },
  ],
  messages: [
    {
      sessionId: "s2",
      sessionName: "Deck state line fix",
      agentType: "claude",
      role: "user",
      snippet: "Can we undo that last turn",
      ranges: [
        [7, 11],
        [22, 26],
      ],
      ts: "2026-10-29T10:00:00Z",
      itemId: "u-1",
    },
  ],
  files: [
    { path: "lib/undo.ts", root: "/r", hits: 3, line: 4, pathRanges: [[4, 8]] },
  ],
  commands: [
    {
      kind: "script",
      id: "c1",
      label: "Run script: Test",
      detail: "npm test",
      projectId: "p1",
      scriptId: "test",
    },
    {
      kind: "action",
      id: "a1",
      label: "Undo turn 4",
      detail: "Restores 2 files, keeps chat above",
      sessionId: "s2",
      action: "undo",
      turnNo: 4,
    },
  ],
  messagesEnabled: true,
  sessionName: "Deck state line fix",
};

test("nextFilter: Tab cycles All → Sessions → Messages → Files → All", () => {
  assert.equal(nextFilter("all", 1, true), "sessions");
  assert.equal(nextFilter("sessions", 1, true), "messages");
  assert.equal(nextFilter("messages", 1, true), "files");
  assert.equal(nextFilter("files", 1, true), "all");
  assert.equal(nextFilter("all", -1, true), "files");
});

test("nextFilter: Messages skipped while the index is off", () => {
  assert.equal(nextFilter("sessions", 1, false), "files");
  assert.equal(nextFilter("files", -1, false), "sessions");
  assert.equal(nextFilter("messages", 1, false), "sessions");
});

test("paletteSections: All splits actions from the other commands", () => {
  const s = paletteSections(response, "all");
  assert.equal(s.sessions.length, 1);
  assert.equal(s.messages.length, 1);
  assert.equal(s.files.length, 1);
  assert.deepEqual(
    s.actions.map((r) => resultKey(r)),
    ["c:a1"]
  );
  assert.deepEqual(
    s.commands.map((r) => resultKey(r)),
    ["c:c1"]
  );
});

test("paletteRows: display order sessions, messages, actions, files, commands", () => {
  const rows = paletteRows(paletteSections(response, "all"));
  assert.deepEqual(
    rows.map((r) => resultKey(r)),
    ["s:s1", "m:s2:u-1", "c:a1", "f:/r:lib/undo.ts", "c:c1"]
  );
});

test("paletteSections: a filter shows its kind only, no commands", () => {
  const files = paletteRows(paletteSections(response, "files"));
  assert.deepEqual(
    files.map((r) => r.kind),
    ["file"]
  );
  const sessions = paletteRows(paletteSections(response, "sessions"));
  assert.deepEqual(
    sessions.map((r) => r.kind),
    ["session"]
  );
});

test("paletteSections: messages hidden when the index is off", () => {
  const off = { ...response, messagesEnabled: false };
  assert.equal(paletteSections(off, "all").messages.length, 0);
  assert.equal(paletteSections(off, "messages").messages.length, 0);
  assert.equal(paletteRows(paletteSections(undefined, "all")).length, 0);
});

test("recentSessionHits: newest first, top 8, project names", () => {
  const sessions = Array.from({ length: 10 }, (_, i) =>
    session(`s${i}`, `Session ${i}`, `2026-10-${10 + i} 08:00:00`)
  );
  const hits = recentSessionHits(sessions, { p1: "agent-os" });
  assert.equal(hits.length, 8);
  assert.equal(hits[0].id, "s9");
  assert.equal(hits[7].id, "s2");
  assert.equal(hits[0].projectName, "agent-os");
  assert.deepEqual(hits[0].nameRanges, []);
});

test("recentSessionHits: a short query filters by name with ranges", () => {
  const sessions = [
    session("a", "KeyboardBar haptics", "2026-10-29 08:00:00"),
    session("b", "Deck state", "2026-10-29 09:00:00"),
  ];
  const hits = recentSessionHits(sessions, {}, "k");
  assert.deepEqual(
    hits.map((h) => h.id),
    ["b", "a"]
  );
  assert.deepEqual(hits[0].nameRanges, [[3, 4]]);
  assert.equal(hits[0].projectName, null);
});

test("moveSelection: stops at either end", () => {
  assert.equal(moveSelection(0, -1, 5), 0);
  assert.equal(moveSelection(4, 1, 5), 4);
  assert.equal(moveSelection(2, 1, 5), 3);
  assert.equal(moveSelection(3, 1, 0), 0);
});

test("highlightParts: splits around ranges, unicode-safe slices", () => {
  assert.deepEqual(highlightParts("Can we undo that", [[7, 11]]), [
    { text: "Can we ", hit: false },
    { text: "undo", hit: true },
    { text: " that", hit: false },
  ]);
  assert.deepEqual(highlightParts("héllo wörld", [[6, 11]]), [
    { text: "héllo ", hit: false },
    { text: "wörld", hit: true },
  ]);
  assert.deepEqual(highlightParts("abc", []), [{ text: "abc", hit: false }]);
});

test("highlightParts: clamps, drops overlaps and out-of-range", () => {
  assert.deepEqual(
    highlightParts("abcdef", [
      [4, 99],
      [0, 2],
      [1, 3],
      [10, 12],
    ]),
    [
      { text: "ab", hit: true },
      { text: "c", hit: true },
      { text: "d", hit: false },
      { text: "ef", hit: true },
    ]
  );
});

test("searchQueryString: trimmed q, defaults left out", () => {
  assert.equal(searchQueryString({ q: "  undo turn " }), "q=undo+turn");
  assert.equal(
    searchQueryString({
      q: "x",
      kind: "files",
      projectId: "p1",
      sessionId: "s1",
    }),
    "q=x&kind=files&projectId=p1&sessionId=s1"
  );
  assert.equal(searchQueryString({ q: "x", kind: "all" }), "q=x");
});

test("recentSessionHits: created_at when never updated, unnamed fallback", () => {
  const hits = recentSessionHits(
    [
      session("a", "", "", { created_at: "2026-10-29 09:00:00" }),
      session("b", "Older", "2026-10-01 09:00:00"),
    ],
    {}
  );
  assert.deepEqual(
    hits.map((h) => h.id),
    ["a", "b"]
  );
  assert.equal(hits[0].name, "Unnamed session");
});

test("resultsCurrent: only the typed query's own, settled results", () => {
  const res = { ...response, query: "dep" };
  assert.equal(resultsCurrent(res, "dep", false), true);
  assert.equal(resultsCurrent(res, " dep ", false), true);
  assert.equal(resultsCurrent(res, "deploy", false), false);
  assert.equal(resultsCurrent(res, "dep", true), false);
  assert.equal(resultsCurrent(undefined, "dep", false), false);
});
