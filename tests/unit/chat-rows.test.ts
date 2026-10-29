import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseName,
  buildRows,
  checkKind,
  checkLabel,
  clockElapsed,
  patchPeek,
  placeTurns,
  shortElapsed,
  shortNames,
  toolLines,
  type ResultItem,
  type ToolItem,
} from "../../components/Chat/rows";
import type { ChatItem } from "../../lib/claude-transcript";
import type { Turn } from "../../lib/turn-types";

const tool = (id: string, name: string, summary: string): ToolItem => ({
  kind: "tool",
  id,
  name,
  summary,
  ts: "2026-10-29T10:00:00.000Z",
});
const result = (
  toolUseId: string,
  extra: Partial<ResultItem> = {}
): ResultItem => ({
  kind: "result",
  id: `r-${toolUseId}`,
  toolUseId,
  isError: false,
  preview: "",
  ...extra,
});
const user = (id: string, ts: string): ChatItem => ({
  kind: "user",
  id,
  text: id,
  ts,
});
const say = (id: string, ts = ""): ChatItem => ({
  kind: "assistant",
  id,
  text: id,
  ts,
});

test("buildRows: a run of tools is one row, results by call", () => {
  const { rows, results } = buildRows([
    user("u1", ""),
    tool("a", "Read", "x.ts"),
    result("a"),
    tool("b", "Read", "y.ts"),
    say("s1"),
    tool("c", "Bash", "ls"),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.id]),
    [
      ["user", "u1"],
      ["tools", "a"],
      ["assistant", "s1"],
      ["tools", "c"],
    ]
  );
  assert.equal(results.get("a")?.id, "r-a");
});

test("toolLines: reads, searches and same-file edits group", () => {
  const tools = [
    tool("1", "Read", "src/a.ts"),
    tool("2", "Read", "src/b.ts"),
    tool("3", "Read", "src/a.ts"),
    tool("4", "Grep", "useFold"),
    tool("5", "Glob", "*.tsx"),
    tool("6", "Edit", "components/DeckStateLine.tsx"),
    tool("7", "Edit", "components/DeckStateLine.tsx"),
    tool("8", "Write", "deck.css"),
  ];
  const results = new Map(
    [
      result("1"),
      result("2"),
      result("3"),
      result("4"),
      result("5"),
      result("6", { added: 30, removed: 9, patch: [" a", "-b", "+c"] }),
      result("7", { added: 8, removed: 0, patch: ["+d"] }),
      result("8", { added: 5, removed: 0, patch: ["+e"] }),
    ].map((r) => [r.toolUseId, r])
  );
  const lines = toolLines(tools, results);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["read", "search", "edit", "edit"]
  );
  const [read, search, edit, write] = lines;
  assert.deepEqual(read.kind === "read" && read.files, [
    "src/a.ts",
    "src/b.ts",
  ]);
  assert.equal(search.kind === "search" && search.patterns.length, 2);
  assert.ok(edit.kind === "edit");
  if (edit.kind === "edit") {
    assert.equal(edit.verb, "Edited");
    assert.equal(edit.added, 38);
    assert.equal(edit.removed, 9);
    assert.deepEqual(edit.patch, [" a", "-b", "+c", "@", "+d"]);
    assert.equal(edit.running, false);
  }
  assert.ok(write.kind === "edit" && write.verb === "Wrote");
});

test("toolLines: running and failed calls, checks, plan and agents", () => {
  const tools = [
    tool("1", "Bash", "npm run typecheck"),
    tool("2", "Bash", "npx tsx --test tests/unit/x.test.ts"),
    tool("3", "Bash", "git status"),
    tool("4", "TodoWrite", ""),
    tool("5", "TaskUpdate", "3"),
    tool("6", "Agent", "Explore"),
    tool("7", "Read", "a.ts"),
  ];
  const results = new Map(
    [result("1"), result("2", { isError: true }), result("3"), result("6")].map(
      (r) => [r.toolUseId, r]
    )
  );
  const lines = toolLines(tools, results);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["check", "check", "tool", "plan", "agent", "read"]
  );
  assert.equal(checkLabel(lines[0] as never), "Type check passed");
  assert.equal(checkLabel(lines[1] as never), "Tests failed");
  assert.equal(lines[3].kind === "plan" && lines[3].count, 2);
  // TodoWrite and TaskUpdate have no results: the line is running
  assert.equal(lines[3].running, true);
  assert.equal(lines[5].running, true);
});

test("checkKind", () => {
  assert.equal(checkKind("npx tsc --noEmit"), "Type check");
  assert.equal(checkKind("npm run test:unit"), "Tests");
  assert.equal(checkKind("npm run lint"), "Lint");
  assert.equal(checkKind("npm run build"), "Build");
  assert.equal(checkKind("git diff"), null);
  assert.equal(checkKind("cat latest.txt"), null);
});

test("patchPeek starts a line above the first change", () => {
  const lines = [" 1", " 2", " 3", "-4", "+5", "+6", " 7", " 8"];
  assert.deepEqual(patchPeek(lines, false), [" 3", "-4", "+5", "+6"]);
  assert.deepEqual(patchPeek(lines, true), lines);
  assert.deepEqual(patchPeek(["+a"], false), ["+a"]);
});

test("baseName and elapsed", () => {
  assert.equal(
    baseName("components/Session/ActivityStrip.tsx"),
    "ActivityStrip.tsx"
  );
  assert.equal(baseName("deck.css"), "deck.css");
  assert.equal(shortElapsed(40_000), "40s");
  assert.equal(shortElapsed(125_000), "2m");
  assert.equal(shortElapsed(3_780_000), "1h 3m");
  assert.equal(clockElapsed(52_000), "0:52");
  assert.equal(clockElapsed(725_000), "12:05");
});

const turn = (turnNo: number, extra: Partial<Turn> = {}): Turn => ({
  turnNo,
  startedAt: null,
  endedAt: 1,
  files: [{ path: "a.ts", status: "M", added: 1, removed: 0 }],
  added: 1,
  removed: 0,
  undoneAt: null,
  transcriptUuid: null,
  promptExcerpt: null,
  ...extra,
});

test("placeTurns: after the turn's last row, by uuid or by time", () => {
  const { rows } = buildRows([
    user("u1", "2026-10-29T10:00:00.000Z"),
    say("s1"),
    tool("t1", "Edit", "a.ts"),
    say("s2"),
    user("u2", "2026-10-29T10:05:00.000Z"),
    say("s3"),
  ]);
  const placed = placeTurns(rows, [
    turn(1, { transcriptUuid: "u1" }),
    turn(2, { startedAt: Date.parse("2026-10-29T10:05:01.000Z") }),
  ]);
  assert.deepEqual(
    [...placed].map(([id, ts]) => [id, ts.map((t) => t.turnNo)]),
    [
      ["s2", [1]],
      ["s3", [2]],
    ]
  );
});

test("placeTurns leaves out turns it can't place or that changed nothing", () => {
  const { rows } = buildRows([
    user("u1", "2026-10-29T10:00:00.000Z"),
    say("s1"),
  ]);
  const placed = placeTurns(rows, [
    // Started long before the first loaded prompt
    turn(1, { startedAt: Date.parse("2026-10-29T09:00:00.000Z") }),
    // No files
    turn(2, { transcriptUuid: "u1", files: [] }),
    // Still running
    turn(3, { transcriptUuid: "u1", endedAt: null }),
    // Unknown uuid, no time
    turn(4, { transcriptUuid: "zzz" }),
  ]);
  assert.equal(placed.size, 0);
  assert.equal(placeTurns([], [turn(1)]).size, 0);
});

test("placeTurns: two turns on one prompt go in order", () => {
  const { rows } = buildRows([
    user("u1", "2026-10-29T10:00:00.000Z"),
    say("s1"),
  ]);
  const placed = placeTurns(rows, [
    turn(3, { transcriptUuid: "u1" }),
    turn(2, { transcriptUuid: "u1" }),
  ]);
  assert.deepEqual(
    placed.get("s1")?.map((t) => t.turnNo),
    [2, 3]
  );
});

test("shortNames tells same-named files apart by their folders", () => {
  const names = shortNames([
    "src/index.ts",
    "test/index.ts",
    "src/app.ts",
    "a/lib/x.ts",
    "b/lib/x.ts",
  ]);
  assert.equal(names.get("src/index.ts"), "src/index.ts");
  assert.equal(names.get("test/index.ts"), "test/index.ts");
  assert.equal(names.get("src/app.ts"), "app.ts");
  assert.equal(names.get("a/lib/x.ts"), "a/lib/x.ts");
  assert.equal(names.get("b/lib/x.ts"), "b/lib/x.ts");
});
