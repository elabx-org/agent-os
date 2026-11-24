import test from "node:test";
import assert from "node:assert/strict";
import {
  previewChoices,
  previewLabel,
  previewPlace,
  previewShown,
  sessionPort,
} from "../../lib/session-preview";

const server = (
  port: number,
  sessionId: string | null,
  startedAt: number | null = null,
  name = "node"
) => ({ port, name, sessionId, startedAt });

test("a session's own servers come first, newest first", () => {
  const { mine, others } = previewChoices(
    [
      server(8080, "other"),
      server(5173, "s1", 100),
      server(3000, null),
      server(4321, "s1", 200),
      server(4000, "s1"),
    ],
    "s1"
  );
  assert.deepEqual(
    mine.map((s) => s.port),
    [4321, 5173, 4000]
  );
  // The rest by port, whoever started them
  assert.deepEqual(
    others.map((s) => s.port),
    [3000, 8080]
  );
});

test("the session's newest shows until another is picked", () => {
  const choices = previewChoices(
    [server(5173, "s1", 100), server(4321, "s1", 200), server(3000, null)],
    "s1"
  );
  assert.equal(previewShown(choices, null)?.port, 4321);
  assert.equal(previewShown(choices, 3000)?.port, 3000);
  // What was picked stopped: back to the session's own
  assert.equal(previewShown(choices, 9999)?.port, 4321);
});

test("nothing of the session's: nothing shows by itself", () => {
  const choices = previewChoices([server(3000, null)], "s1");
  assert.equal(previewShown(choices, null), null);
  assert.equal(previewShown(choices, 3000)?.port, 3000);
  assert.equal(previewShown(previewChoices([], "s1"), 3000), null);
});

test("a server reads as its port and what serves it", () => {
  assert.equal(previewLabel(server(5173, null)), ":5173 node");
  assert.equal(previewLabel(server(8000, null, null, "")), ":8000");
});

test("a session's port is its newest server's, or none", () => {
  const servers = [
    server(8080, "other", 300),
    server(5173, "s1", 100),
    server(4321, "s1", 200),
  ];
  assert.equal(sessionPort(servers, "s1"), 4321);
  assert.equal(sessionPort(servers, "other"), 8080);
  assert.equal(sessionPort(servers, "s2"), null);
  assert.equal(sessionPort(servers, null), null);
  assert.equal(sessionPort([], "s1"), null);
});

test("the preview takes the views' place on the desktop, a page elsewhere", () => {
  assert.equal(previewPlace("desktop", false), "views");
  // The iOS app is never the desktop shell, whatever its width
  assert.equal(previewPlace("desktop", true), "page");
  for (const mode of ["phone", "tabletop", "duo-closed", "duo-open", "book"])
    assert.equal(previewPlace(mode, false), "page", mode);
});
