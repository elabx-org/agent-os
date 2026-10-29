import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { entryItems } from "../../lib/claude-transcript";
import {
  closeSearchDb,
  openSearchDb,
  SEARCH_SCHEMA_VERSION,
} from "../../lib/search/db";
import { forgetSession, indexFile } from "../../lib/search/indexer";
import {
  matchExpression,
  messageSnippet,
  queryMessages,
} from "../../lib/search/query";
import { termRanges } from "../../lib/search/highlight";
import type { Session } from "../../lib/db/types";

const CWD = "/tmp/agentos-search-cwd";
let root = "";
let dbFile = "";
let n = 0;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-search-"));
});

after(() => {
  closeSearchDb();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  closeSearchDb();
  dbFile = path.join(root, `search-${++n}.db`);
});

function db(): Database.Database {
  const opened = openSearchDb(dbFile);
  assert.ok(opened);
  return opened;
}

function uuid(): string {
  return crypto.randomUUID();
}

function user(text: string, ts = "2026-10-01T10:00:00.000Z") {
  return {
    type: "user",
    uuid: uuid(),
    timestamp: ts,
    message: { role: "user", content: text },
  };
}

function assistant(text: string, ts = "2026-10-01T10:00:05.000Z") {
  return {
    type: "assistant",
    uuid: uuid(),
    timestamp: ts,
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        {
          type: "tool_use",
          id: "toolu_" + uuid(),
          name: "Bash",
          input: { command: "grep zebracommand" },
        },
      ],
    },
  };
}

function toolResult(text: string) {
  return {
    type: "user",
    uuid: uuid(),
    timestamp: "2026-10-01T10:00:06.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_x", content: text }],
    },
  };
}

const lines = (...entries: object[]) =>
  entries.map((e) => JSON.stringify(e) + "\n").join("");

function transcript(name: string, content = ""): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, content);
  return file;
}

function rows(d: Database.Database, sessionId = "s1") {
  return d
    .prepare(
      "SELECT role, item_id, text FROM search_messages WHERE session_id = ? ORDER BY rowid"
    )
    .all(sessionId) as { role: string; item_id: string; text: string }[];
}

function session(id: string, name = "Fixture"): Session {
  return { id, name, agent_type: "claude" } as Session;
}

test("incremental offsets: only appended messages are added", async () => {
  const d = db();
  const file = transcript("inc.jsonl", lines(user("first message")));
  const one = await indexFile(d, "s1", file, CWD);
  assert.equal(one.added, 1);
  assert.equal(one.offset, fs.statSync(file).size);
  assert.equal(one.more, false);

  const again = await indexFile(d, "s1", file, CWD);
  assert.equal(again.added, 0);

  fs.appendFileSync(file, lines(assistant("second reply"), user("third")));
  const two = await indexFile(d, "s1", file, CWD);
  assert.equal(two.added, 2);
  assert.deepEqual(
    rows(d).map((r) => r.text),
    ["first message", "second reply", "third"]
  );
});

test("chunks: maxBytes caps a pass and `more` says so", async () => {
  const d = db();
  const content = lines(user("alpha one"), user("beta two"), user("gamma"));
  const file = transcript("chunk.jsonl", content);
  const first = await indexFile(d, "s1", file, CWD, 10);
  // One whole line is read even when longer than the chunk
  assert.equal(first.added, 1);
  assert.equal(first.more, true);
  let result = first;
  while (result.more) result = await indexFile(d, "s1", file, CWD, 10);
  assert.equal(rows(d).length, 3);
  assert.equal(result.offset, Buffer.byteLength(content));
});

test("a partial last line is not consumed", async () => {
  const d = db();
  const whole = lines(user("complete line"));
  const partial = JSON.stringify(user("half written")).slice(0, 30);
  const file = transcript("partial.jsonl", whole + partial);
  const result = await indexFile(d, "s1", file, CWD);
  assert.equal(result.added, 1);
  assert.equal(result.offset, Buffer.byteLength(whole));

  // Only a partial line: nothing moves
  const stuck = await indexFile(d, "s1", file, CWD);
  assert.equal(stuck.added, 0);
  assert.equal(stuck.offset, Buffer.byteLength(whole));
});

test("a file rewritten shorter resets and re-indexes from 0", async () => {
  const d = db();
  const file = transcript(
    "short.jsonl",
    lines(user("old one"), user("old two"), user("old three"))
  );
  await indexFile(d, "s1", file, CWD);
  assert.equal(rows(d).length, 3);

  fs.writeFileSync(file, lines(user("new only")));
  const result = await indexFile(d, "s1", file, CWD);
  assert.equal(result.reset, true);
  assert.equal(result.added, 1);
  assert.deepEqual(
    rows(d).map((r) => r.text),
    ["new only"]
  );
});

test("tool_use and tool_result are skipped", async () => {
  const d = db();
  const file = transcript(
    "tools.jsonl",
    lines(
      assistant("I'll look"),
      toolResult("zebracommand output"),
      { type: "summary", summary: "zebracommand" },
      user("<local-command-stdout>zebracommand</local-command-stdout>")
    ) + "not json\n"
  );
  const result = await indexFile(d, "s1", file, CWD);
  assert.equal(result.added, 1);
  assert.deepEqual(
    rows(d).map((r) => r.text),
    ["I'll look"]
  );
  assert.deepEqual(
    queryMessages(d, "zebracommand", { limit: 5, sessions: [session("s1")] }),
    []
  );
});

test("item ids equal entryItems ids", async () => {
  const d = db();
  const entries = [user("hello there"), assistant("general kenobi")];
  const file = transcript("ids.jsonl", lines(...entries));
  await indexFile(d, "s1", file, CWD);
  const expected = entries
    .flatMap((e) => entryItems(e, CWD))
    .filter((i) => i.kind === "user" || i.kind === "assistant")
    .map((i) => i.id);
  assert.deepEqual(
    rows(d).map((r) => r.item_id),
    expected
  );
  assert.match(expected[1], /-0$/);
});

test("queryMessages: newest first, scoped to the given sessions", async () => {
  const d = db();
  const a = transcript(
    "qa.jsonl",
    lines(
      user("Can we undo that last turn", "2026-10-01T10:00:00.000Z"),
      assistant("I'll undo turn 3 now", "2026-10-02T10:00:00.000Z")
    )
  );
  const b = transcript(
    "qb.jsonl",
    lines(user("undo turn elsewhere", "2026-10-03T10:00:00.000Z"))
  );
  await indexFile(d, "s1", a, CWD);
  await indexFile(d, "s2", b, CWD);

  const hits = queryMessages(d, "undo tur", {
    limit: 10,
    sessions: [session("s1", "Deck state")],
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].role, "assistant");
  assert.equal(hits[0].sessionName, "Deck state");
  assert.equal(hits[0].agentType, "claude");
  assert.equal(hits[0].snippet, "I'll undo turn 3 now");
  assert.deepEqual(hits[0].ranges, [
    [5, 9],
    [10, 13],
  ]);
  assert.equal(hits[1].role, "user");

  const both = queryMessages(d, "undo", {
    limit: 1,
    sessions: [session("s1"), session("s2")],
  });
  assert.equal(both.length, 1);
  assert.equal(both[0].sessionId, "s2");

  forgetSession(d, "s2");
  assert.deepEqual(
    queryMessages(d, "elsewhere", { limit: 5, sessions: [session("s2")] }),
    []
  );
});

test("accented text matches without diacritics", async () => {
  const d = db();
  const file = transcript("accent.jsonl", lines(user("Le café est très bon")));
  await indexFile(d, "s1", file, CWD);
  const hits = queryMessages(d, "cafe", {
    limit: 5,
    sessions: [session("s1")],
  });
  assert.equal(hits.length, 1);
});

test("MATCH escaping: quotes and operators don't throw", async () => {
  const d = db();
  const file = transcript("ops.jsonl", lines(user('say a"b OR near(x) -c *')));
  await indexFile(d, "s1", file, CWD);
  const opts = { limit: 5, sessions: [session("s1")] };
  for (const q of [
    'a"b OR',
    "NEAR(",
    "AND",
    '"',
    "( ) *",
    "-c",
    "col:x",
    "^start",
    "x NOT y",
    "'",
  ]) {
    assert.doesNotThrow(() => queryMessages(d, q, opts), q);
  }
  assert.equal(queryMessages(d, 'a"b OR', opts).length, 1);
  assert.equal(matchExpression("( ) *"), null);
  assert.equal(matchExpression('a"b or'), '"a""b" AND "or"*');
});

test("snippets: short text whole, long text windowed with ellipses", () => {
  assert.equal(messageSnippet("one\n two\tthree", "two"), "one two three");
  const long =
    "word ".repeat(40) + "needle in the middle " + "tail ".repeat(40);
  const snip = messageSnippet(long, "needle");
  assert.ok(snip.startsWith("…") && snip.endsWith("…"), snip);
  assert.ok(Array.from(snip).length <= 92, String(snip.length));
  const [range] = termRanges(snip, "needle");
  assert.equal(snip.slice(range[0], range[1]), "needle");
  // A match near the start: no leading ellipsis
  assert.ok(
    !messageSnippet("needle " + "x ".repeat(80), "needle").startsWith("…")
  );
});

test("unicode snippets: emoji, accents and CJK stay whole", () => {
  const cases: [string, string][] = [
    ["😀👍🏽👨‍👩‍👧".repeat(30) + " target " + "🎉".repeat(60), "target"],
    ["é".repeat(70) + " Café " + "ü".repeat(70), "café"],
    ["漢字".repeat(50) + "検索語" + "日本".repeat(50), "検索語"],
    ["é".repeat(80) + " mark " + "à".repeat(80), "mark"],
  ];
  for (const [text, q] of cases) {
    const snip = messageSnippet(text, q);
    // No lone surrogates
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(snip), q);
    assert.ok(!/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(snip), q);
    // No orphan combining mark or ZWJ right after the ellipsis
    assert.ok(!/^…[̀-ͯ‍️]/.test(snip), q);
    const ranges = termRanges(snip, q);
    assert.equal(ranges.length, 1, q);
    assert.equal(snip.slice(ranges[0][0], ranges[0][1]).toLowerCase(), q);
  }
});

test("schema-version mismatch rebuilds the file", async () => {
  const d = db();
  const file = transcript("ver.jsonl", lines(user("kept before")));
  await indexFile(d, "s1", file, CWD);
  closeSearchDb();

  const raw = new Database(dbFile);
  raw.pragma(`user_version = ${SEARCH_SCHEMA_VERSION + 1}`);
  raw.close();

  const rebuilt = db();
  assert.equal(
    rebuilt.pragma("user_version", { simple: true }),
    SEARCH_SCHEMA_VERSION
  );
  assert.equal(rows(rebuilt).length, 0);
  // Progress went too: the file is indexed again from 0
  const again = await indexFile(rebuilt, "s1", file, CWD);
  assert.equal(again.added, 1);
});

test("a corrupt file is replaced", () => {
  fs.writeFileSync(dbFile, "this is not a sqlite database at all".repeat(200));
  const d = db();
  assert.equal(
    d.pragma("user_version", { simple: true }),
    SEARCH_SCHEMA_VERSION
  );
  assert.equal(rows(d).length, 0);
});

test("openSearchDb caches one handle per file", () => {
  const a = db();
  assert.equal(openSearchDb(dbFile), a);
  closeSearchDb();
  assert.equal(a.open, false);
});
