import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanShare,
  inShare,
  parseShare,
  shareWithProject,
} from "../../lib/backup/share";
import { placeText, type Place } from "../../lib/backup/share-types";
import {
  revisionText,
  syncSummary,
  type SyncRow,
} from "../../lib/backup/share-types";
import { OWN_PATH, isOwnCall, ownProof } from "../../lib/link/own-proof";
import { isForwardablePath } from "../../lib/link/client";

test("share: off unless a choice is stored", () => {
  assert.deepEqual(parseShare(null), { level: "none", projects: [] });
  assert.deepEqual(parseShare("{nope"), { level: "none", projects: [] });
  assert.deepEqual(parseShare('{"level":"everything"}'), {
    level: "none",
    projects: [],
  });
  assert.deepEqual(parseShare('{"level":"some","projects":["p1","p1"]}'), {
    level: "some",
    projects: ["p1"],
  });
});

test("share: a choice that isn't one is refused", () => {
  assert.equal(cleanShare(null), null);
  assert.equal(cleanShare({ level: "some", projects: ["../x"] }), null);
  assert.equal(cleanShare({ level: "some", projects: [1] }), null);
  assert.deepEqual(cleanShare({ level: "all" }), {
    level: "all",
    projects: [],
  });
});

test("share: which sessions a machine gets", () => {
  const s = { project_id: "p1" };
  assert.equal(inShare(s, { level: "none", projects: ["p1"] }), false);
  assert.equal(inShare(s, { level: "some", projects: ["p1"] }), true);
  assert.equal(inShare(s, { level: "some", projects: ["p2"] }), false);
  assert.equal(
    inShare({ project_id: null }, { level: "some", projects: [] }),
    false
  );
  assert.equal(
    inShare({ project_id: null }, { level: "all", projects: [] }),
    true
  );
});

test("share: this server's own calls reach only a machine's inbox", () => {
  const proof = ownProof();
  assert.equal(isOwnCall("/api/link/inbox/backup/abc/begin", proof), true);
  assert.equal(isOwnCall("/api/link/inbox/peer/sweep", proof), true);
  assert.equal(isOwnCall("/api/sessions", proof), false);
  assert.equal(isOwnCall("/api/link/inbox/taken/abc", proof), false);
  assert.equal(isOwnCall("/api/link/inbox/backup/abc/begin", "x"), false);
  assert.equal(isOwnCall("/api/link/inbox/backup/abc/begin", null), false);
  assert.equal(OWN_PATH.test("/api/link/inbox/backup/a b"), false);
  assert.equal(isForwardablePath("/api/link/inbox/backup/abc/begin"), true);
});

const row = (over: Partial<SyncRow>): SyncRow => ({
  sessionId: "s",
  name: "Session 1",
  projectName: null,
  direction: "to",
  state: "synced",
  syncedAt: 1,
  head: "3f9c2ab0000000000000000000000000000000ff",
  unsaved: 0,
  entries: 214,
  ...over,
});

test("share: what the sync check says", () => {
  assert.equal(revisionText(row({})), "214 entries, code at 3f9c2ab");
  assert.equal(
    revisionText(row({ unsaved: 3, entries: 1 })),
    "1 entry, code at 3f9c2ab + 3 unsaved files"
  );
  assert.equal(revisionText(row({ head: null, entries: null })), "no code");
  assert.equal(
    syncSummary({ rows: [], online: true }),
    "Nothing is shared yet"
  );
  assert.equal(
    syncSummary({ rows: [row({})], online: true }),
    "Everything is in sync"
  );
  assert.equal(
    syncSummary({ rows: [row({ state: "waiting" })], online: false }),
    "Waiting for it to come online"
  );
  assert.equal(
    syncSummary({
      rows: [row({ state: "failed" }), row({ state: "waiting" })],
      online: true,
    }),
    "1 session couldn't be copied"
  );
});

test("a sent project joins what the machine gets", () => {
  assert.deepEqual(shareWithProject({ level: "none", projects: [] }, "p1"), {
    level: "some",
    projects: ["p1"],
  });
  assert.deepEqual(
    shareWithProject({ level: "some", projects: ["p1"] }, "p2"),
    { level: "some", projects: ["p1", "p2"] }
  );
  // Already shared, or everything is: nothing to change
  assert.equal(
    shareWithProject({ level: "some", projects: ["p1"] }, "p1"),
    null
  );
  assert.equal(shareWithProject({ level: "all", projects: [] }, "p1"), null);
  // Not an id a share takes
  assert.equal(shareWithProject({ level: "none", projects: [] }, "../x"), null);
});

test("a copy's line says where it is and how old", () => {
  const age = () => "2 minutes";
  const place: Place = {
    machineId: "m_000000000001",
    name: "Mac Studio",
    kind: "mac",
    state: "synced",
    syncedAt: Date.now() - 120_000,
    entries: 4,
    head: "abc1234",
    unsaved: 0,
  };
  assert.equal(placeText(place, age), "Copy on Mac Studio, 2 minutes old.");
  assert.equal(
    placeText({ ...place, state: "waiting" }, age),
    "Copy on Mac Studio, 2 minutes old. Copying what changed."
  );
  assert.equal(
    placeText({ ...place, state: "waiting", syncedAt: null }, age),
    "Copying to Mac Studio for the first time."
  );
  assert.equal(
    placeText({ ...place, state: "failed", syncedAt: null }, age),
    "The copy to Mac Studio didn't go through."
  );
});
