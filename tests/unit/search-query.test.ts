import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../../lib/db";
import type { Turn } from "../../lib/turn-types";
import {
  filterCommands,
  isSearchable,
  mergeFileHits,
  parseCounts,
  parseFirstLines,
  scriptCommands,
  searchFiles,
  searchSessions,
  setRipgrepForTests,
  slashCommands,
  sqliteToIso,
  turnActions,
} from "../../lib/search/sections";

function session(over: Partial<Session>): Session {
  return {
    id: "s",
    name: "",
    updated_at: "2026-10-01 10:00:00",
    agent_type: "claude",
    project_id: null,
    branch_name: null,
    working_directory: "/w/repo",
    conductor_session_id: null,
    ...over,
  } as Session;
}

describe("isSearchable", () => {
  test("shorter than MIN_QUERY (trimmed) is not", () => {
    assert.equal(isSearchable(""), false);
    assert.equal(isSearchable(" a  "), false);
    assert.equal(isSearchable("ab"), true);
  });
});

describe("searchSessions", () => {
  const projects = new Map([["p1", "agent-os"]]);

  test("name prefix, then name word, then substring, then branch", () => {
    const hits = searchSessions(
      "undo",
      [
        session({ id: "branch", name: "Other", branch_name: "undo-fix" }),
        session({ id: "sub", name: "Redo or reundo" }),
        session({ id: "word", name: "Turn level undo for Codex" }),
        session({ id: "prefix", name: "Undo turn checkpoints" }),
      ],
      projects,
      8
    );
    assert.deepEqual(
      hits.map((h) => h.id),
      ["prefix", "word", "sub", "branch"]
    );
    assert.deepEqual(hits[0].nameRanges, [[0, 4]]);
    assert.equal(hits[0].updatedAt, "2026-10-01T10:00:00Z");
  });

  test("every term must match somewhere; project and folder count", () => {
    const hits = searchSessions(
      "haptics agent",
      [
        session({ id: "a", name: "KeyboardBar haptics", project_id: "p1" }),
        session({ id: "b", name: "Haptics setting" }),
        session({
          id: "c",
          name: "haptics fold",
          working_directory: "/x/agent-tools",
        }),
      ],
      projects,
      8
    );
    assert.deepEqual(hits.map((h) => h.id).sort(), ["a", "c"]);
    assert.equal(hits.find((h) => h.id === "a")?.projectName, "agent-os");
  });

  test("workers left out, ties newest first, capped", () => {
    const hits = searchSessions(
      "deck",
      [
        session({
          id: "old",
          name: "Deck one",
          updated_at: "2026-01-01 00:00:00",
        }),
        session({
          id: "new",
          name: "Deck two",
          updated_at: "2026-02-01 00:00:00",
        }),
        session({ id: "w", name: "Deck worker", conductor_session_id: "new" }),
      ],
      projects,
      1
    );
    assert.deepEqual(
      hits.map((h) => h.id),
      ["new"]
    );
  });

  test("empty query finds nothing", () => {
    assert.deepEqual(
      searchSessions("  ", [session({ name: "x" })], projects, 8),
      []
    );
  });

  test("sqliteToIso leaves ISO alone", () => {
    assert.equal(
      sqliteToIso("2026-10-01T10:00:00.000Z"),
      "2026-10-01T10:00:00.000Z"
    );
  });
});

describe("file hit parsing and merging", () => {
  test("rg --null output", () => {
    assert.deepEqual(
      [...parseCounts("./lib/a.ts\x003\n./b:c.ts\x001\n\n").entries()],
      [
        ["lib/a.ts", 3],
        ["b:c.ts", 1],
      ]
    );
    assert.deepEqual(
      [...parseFirstLines("./lib/a.ts\x0012:foo haptics\n").entries()],
      [["lib/a.ts", 12]]
    );
  });

  test("path matches first, then hits; content merged into path hits", () => {
    const hits = mergeFileHits(
      "haptics",
      "/r",
      ["lib/haptics.ts", "docs/haptics.md"],
      new Map([
        ["lib/haptics.ts", 12],
        ["ios/KeyboardBar.swift", 3],
        ["ios/Other.swift", 7],
      ]),
      10
    );
    assert.deepEqual(
      hits.map((h) => [h.path, h.hits]),
      [
        ["lib/haptics.ts", 12],
        ["docs/haptics.md", 0],
        ["ios/Other.swift", 7],
        ["ios/KeyboardBar.swift", 3],
      ]
    );
    assert.deepEqual(hits[0].pathRanges, [[4, 11]]);
    assert.equal(hits[0].root, "/r");
  });
});

describe("searchFiles (temp git repo)", () => {
  let repo = "";
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });

  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-search-"));
    git("init", "-q");
    fs.mkdirSync(path.join(repo, "lib"));
    fs.mkdirSync(path.join(repo, "ios"));
    fs.writeFileSync(
      path.join(repo, "lib/haptics.ts"),
      "export const a = 1;\n// haptics\nhaptics();\n"
    );
    fs.writeFileSync(
      path.join(repo, "ios/KeyboardBar.swift"),
      "let x = 0\nlet y = 1\n// Haptics on keys\n"
    );
    fs.writeFileSync(path.join(repo, "README.md"), "nothing here\n");
    fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.txt\n");
    fs.writeFileSync(path.join(repo, "ignored.txt"), "haptics haptics\n");
    git("add", "-A");
  });

  after(() => {
    setRipgrepForTests(null);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test("ripgrep: path + content merged, relative, first line, ignores respected", async (t) => {
    setRipgrepForTests(null);
    const hits = await searchFiles("Haptics", repo, 10);
    if (!hits.length) return t.skip("ripgrep not installed");
    assert.deepEqual(
      hits.map((h) => [h.path, h.hits, h.line]),
      [
        ["lib/haptics.ts", 2, 2],
        ["ios/KeyboardBar.swift", 1, 3],
      ]
    );
    assert.equal(hits[0].root, path.resolve(repo));
  });

  test("without ripgrep: path matches from git ls-files", async () => {
    setRipgrepForTests(false);
    const hits = await searchFiles("lib hapt", repo, 10);
    assert.deepEqual(
      hits.map((h) => [h.path, h.hits]),
      [["lib/haptics.ts", 0]]
    );
  });

  test("bad roots find nothing", async () => {
    setRipgrepForTests(null);
    assert.deepEqual(await searchFiles("haptics", "/", 10), []);
    assert.deepEqual(await searchFiles("haptics", "lib", 10), []);
    assert.deepEqual(
      await searchFiles("haptics", path.join(repo, "missing"), 10),
      []
    );
  });
});

describe("commands", () => {
  const turn = (turnNo: number, over: Partial<Turn> = {}): Turn => ({
    turnNo,
    startedAt: 1,
    endedAt: 2,
    files: [
      { path: "a.ts", status: "M", added: 30, removed: 9 },
      { path: "b.ts", status: "A", added: 8, removed: 0 },
    ],
    added: 38,
    removed: 9,
    undoneAt: null,
    transcriptUuid: null,
    promptExcerpt: null,
    ...over,
  });

  test("turn actions: undo the newest not undone, diff the newest", () => {
    const actions = turnActions("s1", [
      turn(3),
      turn(4),
      turn(5, { undoneAt: 9 }),
      turn(6, { files: [] }),
    ]);
    assert.deepEqual(
      actions.map((a) => [a.label, a.turnNo, a.detail]),
      [
        ["Undo turn 4", 4, "Restores 2 files, keeps chat above"],
        ["Open diff: This turn", 5, "Turn 5 · 2 files"],
      ]
    );
    assert.equal(actions[1].added, 38);
    assert.deepEqual(turnActions("s1", []), []);
  });

  const candidates = {
    actions: turnActions("s1", [turn(4)]),
    scripts: scriptCommands("p1", [
      { id: "test", name: "Test", command: "npx tsx --test haptics.test.ts" },
      { id: "dev", name: "Dev", command: "npm run dev" },
    ]),
    slash: slashCommands("s1", [
      { name: "review", description: "Review a PR", source: "builtin" },
      {
        name: "code-review",
        description: "Review the diff",
        source: "builtin",
      },
      { name: "review", description: "dup", source: "user" },
    ]),
  };

  test("undo turn lists both actions (any word), not the rest", () => {
    assert.deepEqual(
      filterCommands("undo turn", candidates, 6).map((c) => c.label),
      ["Undo turn 4", "Open diff: This turn"]
    );
    assert.deepEqual(
      filterCommands("diff", candidates, 6).map((c) => c.label),
      ["Open diff: This turn"]
    );
  });

  test("scripts match label or command; slash by name, prefix first", () => {
    assert.deepEqual(
      filterCommands("haptics", candidates, 6).map((c) => c.label),
      ["Run script: Test"]
    );
    assert.deepEqual(
      filterCommands("/review", candidates, 6).map((c) => c.label),
      ["/review", "/code-review"]
    );
    const slash = filterCommands("review", candidates, 6)[0];
    assert.equal(slash.kind, "slash");
    assert.equal(slash.kind === "slash" && slash.command, "/review ");
  });

  test("order actions, scripts, slash; capped", () => {
    const all = {
      ...candidates,
      scripts: scriptCommands("p1", [
        { id: "t", name: "Turn tests", command: "npm test" },
      ]),
      slash: slashCommands("s1", [
        { name: "turnstile", description: "x", source: "user" },
      ]),
    };
    assert.deepEqual(
      filterCommands("turn", all, 6).map((c) => c.kind),
      ["action", "action", "script", "slash"]
    );
    assert.equal(filterCommands("turn", all, 3).length, 3);
    assert.deepEqual(filterCommands(" ", all, 6), []);
  });
});
