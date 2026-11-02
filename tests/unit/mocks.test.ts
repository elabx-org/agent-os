import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ABANDON_MS,
  applyInbox,
  changeMocks,
  effectiveStatus,
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
});
