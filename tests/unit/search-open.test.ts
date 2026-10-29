import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JUMP_MAX_PAGES,
  joinPath,
  jumpVerdict,
  openSteps,
  prependCommand,
  searchRequestVerdict,
} from "../../components/Search/open-result";
import {
  effectiveFilter,
  messageMeta,
  pageChips,
  recentSessionHits,
  resultCount,
  resultCountText,
  visibleSections,
} from "../../components/Search/search-page-model";
import type { SearchResult } from "../../components/Search/types";
import type { SearchResponse } from "../../lib/search/types";
import type { Session } from "../../lib/db";
import type { SearchRequest } from "../../stores/searchActions";

const message: SearchResult = {
  kind: "message",
  hit: {
    sessionId: "s2",
    sessionName: "Haptics",
    agentType: "claude",
    role: "assistant",
    snippet: "Light haptic",
    ranges: [[6, 12]],
    ts: "2026-10-29T10:00:00Z",
    itemId: "item-7",
  },
};

test("joinPath: root and relative path, no doubled or missing slashes", () => {
  assert.equal(joinPath("/repo", "lib/a.ts"), "/repo/lib/a.ts");
  assert.equal(joinPath("/repo/", "./lib/a.ts"), "/repo/lib/a.ts");
  assert.equal(joinPath("/repo", "/lib/a.ts"), "/repo/lib/a.ts");
  assert.equal(joinPath("/repo", ""), "/repo");
  assert.equal(joinPath("", "lib/a.ts"), "lib/a.ts");
});

test("openSteps: a session opens, or opens beside", () => {
  const hit = {
    id: "s1",
    name: "A",
    agentType: "claude",
    projectId: null,
    projectName: null,
    branch: null,
    updatedAt: "",
    nameRanges: [],
  };
  assert.deepEqual(openSteps({ kind: "session", hit }, {}), [
    { kind: "select", sessionId: "s1" },
  ]);
  assert.deepEqual(openSteps({ kind: "session", hit }, {}, { beside: true }), [
    { kind: "beside", sessionId: "s1" },
  ]);
});

test("openSteps: a message opens its session, then jumps (switching to chat)", () => {
  assert.deepEqual(openSteps(message, { currentSessionId: "s1" }), [
    { kind: "select", sessionId: "s2" },
    { kind: "jump", sessionId: "s2", itemId: "item-7", switchView: true },
  ]);
  // Already focused: no re-attach, just the jump
  assert.deepEqual(openSteps(message, { currentSessionId: "s2" }), [
    { kind: "jump", sessionId: "s2", itemId: "item-7", switchView: true },
  ]);
  // Beside opens in chat itself
  assert.deepEqual(openSteps(message, {}, { beside: true }), [
    { kind: "beside", sessionId: "s2" },
    { kind: "jump", sessionId: "s2", itemId: "item-7", switchView: false },
  ]);
});

test("openSteps: a file opens at its line (1 when only the path matched)", () => {
  const file = (line?: number): SearchResult => ({
    kind: "file",
    hit: { path: "lib/h.ts", root: "/r", hits: 2, line, pathRanges: [] },
  });
  assert.deepEqual(openSteps(file(12), {}), [
    { kind: "file", file: "/r/lib/h.ts", line: 12 },
  ]);
  assert.deepEqual(openSteps(file(), {}), [
    { kind: "file", file: "/r/lib/h.ts", line: 1 },
  ]);
});

test("openSteps: a script runs with the focused project's runner, else its sheet", () => {
  const script: SearchResult = {
    kind: "command",
    hit: {
      kind: "script",
      id: "c1",
      label: "Run script: Test",
      detail: "npm test",
      projectId: "p1",
      scriptId: "test",
    },
  };
  assert.deepEqual(
    openSteps(script, { runnerProjectId: "p1", runnerScriptIds: ["test"] }),
    [{ kind: "runScript", projectId: "p1", scriptId: "test" }]
  );
  // Another project, or the config not loaded yet
  assert.deepEqual(
    openSteps(script, { runnerProjectId: "p2", runnerScriptIds: ["test"] }),
    [{ kind: "openScripts", projectId: "p1" }]
  );
  assert.deepEqual(openSteps(script, { runnerProjectId: "p1" }), [
    { kind: "openScripts", projectId: "p1" },
  ]);
});

test("openSteps: slash commands and turn actions go to the session's views", () => {
  const slash: SearchResult = {
    kind: "command",
    hit: {
      kind: "slash",
      id: "c2",
      label: "/review",
      detail: "Review",
      command: "/review ",
      sessionId: "s1",
    },
  };
  assert.deepEqual(openSteps(slash, { currentSessionId: "s1" }), [
    {
      kind: "request",
      request: { kind: "slash", sessionId: "s1", command: "/review " },
    },
  ]);
  assert.deepEqual(openSteps(slash, { currentSessionId: "s9" })[0], {
    kind: "select",
    sessionId: "s1",
  });

  const undo: SearchResult = {
    kind: "command",
    hit: {
      kind: "action",
      id: "c3",
      label: "Undo turn 4",
      detail: "",
      sessionId: "s1",
      action: "undo",
      turnNo: 4,
    },
  };
  assert.deepEqual(openSteps(undo, { currentSessionId: "s1" }), [
    { kind: "chat", sessionId: "s1" },
    {
      kind: "request",
      request: { kind: "turn", sessionId: "s1", turnNo: 4, action: "undo" },
    },
  ]);
});

test("searchRequestVerdict: only this session's kind, while active and fresh", () => {
  const now = 100_000;
  const req: SearchRequest = {
    kind: "turn",
    sessionId: "s1",
    turnNo: 2,
    action: "diff",
    at: now - 1000,
  };
  const v = (
    r: SearchRequest | null,
    sid = "s1",
    kind: SearchRequest["kind"] = "turn",
    active = true
  ) => searchRequestVerdict(r, sid, kind, active, 10_000, now);
  assert.equal(v(req), "take");
  assert.equal(v(null), "wait");
  assert.equal(v(req, "s2"), "wait");
  assert.equal(v(req, "s1", "slash"), "wait");
  assert.equal(v(req, "s1", "turn", false), "wait");
  assert.equal(v({ ...req, at: now - 10_001 }), "drop");
  // Stale is dropped by whoever sees it
  assert.equal(v({ ...req, at: now - 20_000 }, "other", "slash"), "drop");
});

test("prependCommand: first in the box, replacing a command already there", () => {
  assert.deepEqual(prependCommand("", "/review "), {
    text: "/review ",
    caret: 8,
  });
  assert.deepEqual(prependCommand("check the tests", "/review "), {
    text: "/review check the tests",
    caret: 8,
  });
  assert.deepEqual(prependCommand("/rev", "/review"), {
    text: "/review ",
    caret: 8,
  });
  assert.deepEqual(prependCommand("  /compact keep it short", "/review "), {
    text: "/review keep it short",
    caret: 8,
  });
  // A path isn't a command
  assert.equal(
    prependCommand("see ./a/b", "/review ").text,
    "/review see ./a/b"
  );
});

test("jumpVerdict: scroll when found, page up while it can, drop when old", () => {
  const base = {
    found: false,
    ageMs: 100,
    ttlMs: 10_000,
    canLoad: true,
    loading: false,
    pages: 0,
  };
  assert.equal(jumpVerdict({ ...base, found: true }), "scroll");
  assert.equal(jumpVerdict(base), "load");
  assert.equal(jumpVerdict({ ...base, loading: true }), "wait");
  assert.equal(jumpVerdict({ ...base, canLoad: false }), "wait");
  assert.equal(jumpVerdict({ ...base, pages: JUMP_MAX_PAGES }), "wait");
  assert.equal(jumpVerdict({ ...base, pages: JUMP_MAX_PAGES - 1 }), "load");
  assert.equal(jumpVerdict({ ...base, ageMs: 10_001, found: true }), "drop");
});

function response(over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: "haptics",
    sessions: [
      {
        id: "s1",
        name: "KeyboardBar haptics",
        agentType: "claude",
        projectId: null,
        projectName: null,
        branch: null,
        updatedAt: "",
        nameRanges: [],
      },
    ],
    messages: [message.hit as SearchResponse["messages"][number]],
    files: [],
    commands: [
      {
        kind: "script",
        id: "c1",
        label: "Run script: Test",
        detail: "",
        projectId: "p",
        scriptId: "t",
      },
    ],
    messagesEnabled: true,
    ...over,
  };
}

test("page model: chips, sections per chip, count", () => {
  const res = response();
  assert.deepEqual(
    pageChips(res).map((c) => `${c.label}${c.n ?? ""}`),
    ["All", "Sessions1", "Messages1", "Files0"]
  );
  assert.deepEqual(visibleSections(res, "all"), [
    "sessions",
    "messages",
    "commands",
  ]);
  assert.deepEqual(visibleSections(res, "messages"), ["messages"]);
  assert.deepEqual(visibleSections(res, "files"), []);
  assert.equal(resultCount(res), 3);
  assert.equal(resultCountText(1), "1 result");
  assert.equal(resultCountText(10), "10 results");
});

test("page model: index off hides Messages and its chip falls back to All", () => {
  const res = response({ messagesEnabled: false, messages: [] });
  assert.deepEqual(
    pageChips(res).map((c) => c.label),
    ["All", "Sessions", "Files"]
  );
  assert.equal(effectiveFilter("messages", res), "all");
  assert.equal(effectiveFilter("files", res), "files");
  assert.deepEqual(visibleSections(res, "all"), ["sessions", "commands"]);
});

test("page model: recent sessions newest first, capped", () => {
  const s = (id: string, updated_at: string) =>
    ({
      id,
      name: id,
      agent_type: "codex",
      project_id: null,
      branch_name: null,
      updated_at,
      created_at: updated_at,
    }) as unknown as Session;
  const hits = recentSessionHits(
    [
      s("old", "2026-10-01 10:00:00"),
      s("new", "2026-10-29 10:00:00"),
      s("mid", "2026-10-15 10:00:00"),
    ],
    2
  );
  assert.deepEqual(
    hits.map((h) => h.id),
    ["new", "mid"]
  );
  assert.equal(hits[0].agentType, "codex");
  assert.deepEqual(hits[0].nameRanges, []);
});

test("page model: message meta line", () => {
  assert.equal(
    messageMeta("user", "Claude", "KeyboardBar haptics", "9m"),
    "You · KeyboardBar haptics · 9m"
  );
  assert.equal(
    messageMeta("assistant", "Codex", "Signing", ""),
    "Codex · Signing"
  );
});
