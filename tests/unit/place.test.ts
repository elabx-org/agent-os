import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlace } from "../../stores/place";

test("parsePlace: none, or not a place", () => {
  assert.equal(parsePlace(null), null);
  assert.equal(parsePlace(""), null);
  assert.equal(parsePlace("{"), null);
  assert.equal(parsePlace("42"), null);
});

test("parsePlace: a project page over Projects, back to it", () => {
  const place = parsePlace(
    JSON.stringify({
      home: true,
      homeTab: "projects",
      page: { kind: "project", projectId: "p1" },
      previous: null,
      inbox: false,
      find: false,
      settings: null,
      view: null,
    })
  );
  assert.deepEqual(place, {
    home: true,
    homeTab: "projects",
    page: { kind: "project", projectId: "p1" },
    previous: null,
    inbox: false,
    find: false,
    settings: null,
    view: null,
  });
});

test("parsePlace: what it doesn't know is left out", () => {
  const place = parsePlace(
    JSON.stringify({
      home: "yes",
      homeTab: "elsewhere",
      page: { kind: "nowhere" },
      settings: { section: "keys", detail: 1 },
      view: { sessionId: "s1", mode: "terminal" },
    })
  );
  assert.equal(place?.home, false);
  assert.equal(place?.homeTab, "now");
  assert.equal(place?.page, null);
  assert.deepEqual(place?.settings, { section: "keys", detail: true });
  // Only Changes and Files: the session's own view comes back by itself
  assert.equal(place?.view, null);
  assert.deepEqual(
    parsePlace(JSON.stringify({ view: { sessionId: "s1", mode: "git" } }))
      ?.view,
    { sessionId: "s1", mode: "git" }
  );
});
