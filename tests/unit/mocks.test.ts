import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import {
  ABANDON_MS,
  applyInbox,
  changeMocks,
  effectiveStatus,
  lastMockMentions,
  MOCK_PAGE_CSP,
  mockChangesText,
  mockDecisionText,
  mockDocument,
  mockId,
  mockPageFile,
  toMock,
  type MockRow,
} from "@/lib/mocks";
import { runMigrations } from "@/lib/db/migrations";
import { createSchema } from "@/lib/db/schema";

function db() {
  const d = new Database(":memory:");
  createSchema(d);
  runMigrations(d);
  return d;
}
const row = (d: Database.Database, url: string) =>
  d.prepare(`SELECT * FROM mocks WHERE url = ?`).get(url) as MockRow;
const names = { session: () => "Session 24", project: () => "agent-os" };
const URL = "https://claude.ai/artifact/AbC";

describe("mocks", () => {
  test("a publish starts ongoing with its session's project", () => {
    const d = db();
    applyInbox(
      d,
      [{ t: 1000, session: "s1", url: URL, version: 1, title: "Rail" }],
      (id) => (id === "s1" ? "p1" : null)
    );
    const r = row(d, URL);
    assert.equal(r.status, "ongoing");
    assert.equal(r.status_by, "auto");
    assert.equal(r.project_id, "p1");
    assert.equal(r.title, "Rail");
    assert.equal(r.versions, 1);
  });

  test("a new version counts up and brings a closed or archived mock back", () => {
    const d = db();
    applyInbox(
      d,
      [{ t: 1000, session: "s1", url: URL, version: 1 }],
      () => null
    );
    changeMocks(d, [URL], { status: "rejected" }, "user", 2000);
    changeMocks(d, [URL], { archived: true }, "user", 2000);
    applyInbox(
      d,
      [{ t: 3000, session: "s1", url: URL, version: 2 }],
      () => null
    );
    const r = row(d, URL);
    assert.equal(r.versions, 2);
    assert.equal(r.status, "ongoing");
    assert.equal(r.status_note, "New version after rejected");
    assert.equal(r.archived_at, null);
    assert.equal(r.updated_at, 3000);
  });

  test("a quiet ongoing mock reads abandoned only while the hook set it", () => {
    const quiet = { status: "ongoing" as const, updated_at: 0 };
    assert.deepEqual(
      effectiveStatus({ ...quiet, status_by: "auto" }, ABANDON_MS),
      { status: "abandoned", auto: true }
    );
    assert.equal(
      effectiveStatus({ ...quiet, status_by: "auto" }, ABANDON_MS - 1).status,
      "ongoing"
    );
    assert.equal(
      effectiveStatus({ ...quiet, status_by: "user" }, ABANDON_MS * 2).status,
      "ongoing"
    );
  });

  test("the user's and a session's changes, PRs and archiving", () => {
    const d = db();
    applyInbox(d, [{ t: 1000, session: "s1", url: URL }], () => null);
    assert.equal(
      changeMocks(d, [URL], { status: "completed", pr: "#162" }, "session", 5),
      1
    );
    let m = toMock(row(d, URL), names, 10);
    assert.equal(m.status, "completed");
    assert.equal(m.statusBy, "session");
    assert.equal(m.pr, "#162");
    changeMocks(d, [URL], { archived: true }, "user", 6);
    m = toMock(row(d, URL), names, 10);
    assert.equal(m.archived, true);
    assert.equal(m.status, "completed");
    assert.equal(changeMocks(d, ["nope"], { archived: true }, "user", 7), 0);
    assert.throws(() =>
      changeMocks(d, [URL], { status: "done" as never }, "user", 8)
    );
  });

  test("approved: the user's go-ahead, reopened by a new version", () => {
    const d = db();
    applyInbox(d, [{ t: 1000, session: "s1", url: URL }], () => null);
    changeMocks(d, [URL], { status: "approved" }, "user", 2000);
    let m = toMock(row(d, URL), names, ABANDON_MS * 2);
    // Approved isn't a quiet ongoing mock: it never reads as abandoned
    assert.equal(m.status, "approved");
    assert.equal(m.statusBy, "user");
    applyInbox(
      d,
      [{ t: 3000, session: "s1", url: URL, version: 2 }],
      () => null
    );
    m = toMock(row(d, URL), names, 4000);
    assert.equal(m.status, "ongoing");
    assert.equal(m.statusNote, "New version after approved");
  });

  test("the page AgentOS shows: the published copy, else the file", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mocks-"));
    const before = process.env.AGENT_OS_HOME;
    process.env.AGENT_OS_HOME = home;
    try {
      const file = path.join(home, "page.html");
      const mock = { url: URL, file };
      assert.equal(mockPageFile(mock), null);
      fs.writeFileSync(file, "<p>now</p>");
      assert.deepEqual(mockPageFile(mock), { file, snapshot: false });
      // Markdown pages and other files aren't shown
      assert.equal(mockPageFile({ url: URL, file: "/etc/passwd" }), null);
      const copies = path.join(home, "claude-state", "mock-snapshots");
      fs.mkdirSync(copies, { recursive: true });
      fs.writeFileSync(path.join(copies, "AbC.html"), "<p>published</p>");
      assert.deepEqual(mockPageFile(mock), {
        file: path.join(copies, "AbC.html"),
        snapshot: true,
      });
      const d = db();
      applyInbox(d, [{ t: 1, session: "s1", url: URL, file }], () => null);
      assert.equal(
        toMock(row(d, URL), names, 2, (r) => !!mockPageFile(r)).preview,
        true
      );
      assert.equal(toMock(row(d, URL), names, 2).preview, false);
    } finally {
      if (before === undefined) delete process.env.AGENT_OS_HOME;
      else process.env.AGENT_OS_HOME = before;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("the page is wrapped as the Artifact tool wraps it, and kept apart", () => {
    const doc = mockDocument("<title>Rail</title><p>x</p>");
    assert.match(doc, /^<!doctype html><html><head><meta charset="utf-8">/);
    assert.match(doc, /<body><title>Rail<\/title><p>x<\/p><\/body>/);
    const whole = "<!DOCTYPE html><html><body>x</body></html>";
    assert.equal(mockDocument(whole), whole);
    // Its own origin, and nothing fetched from AgentOS
    assert.match(MOCK_PAGE_CSP, /^sandbox allow-scripts;/);
    assert.doesNotMatch(MOCK_PAGE_CSP, /allow-same-origin/);
    assert.match(MOCK_PAGE_CSP, /default-src 'none'/);
    assert.doesNotMatch(MOCK_PAGE_CSP, /connect-src/);
  });

  test("a chat's mocks: ids, the last message linking each, the words sent", () => {
    assert.equal(mockId(URL), "AbC");
    assert.equal(mockId("https://claude.ai/code/artifact/x-1_y?v=2"), "x-1_y");
    assert.equal(mockId("https://example.com/artifact/AbC"), null);
    const last = lastMockMentions([
      { id: "a1", text: `First [Rail](${URL})` },
      { id: "a2", text: "Nothing here" },
      {
        id: "a3",
        text: `Version 2: ${URL} and https://claude.ai/artifact/Zz9`,
      },
    ]);
    assert.deepEqual(
      [...last],
      [
        ["AbC", "a3"],
        ["Zz9", "a3"],
      ]
    );
    assert.equal(
      mockDecisionText("approved", "Rail"),
      'Approved the mock "Rail". Build it.'
    );
    assert.equal(
      mockDecisionText("rejected", "Rail"),
      'Rejected the mock "Rail". Don\'t build it.'
    );
    assert.equal(mockChangesText("Rail"), 'Changes to the mock "Rail": ');
  });
});
