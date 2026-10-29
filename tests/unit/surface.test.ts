import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceFor, type SurfaceInputs } from "../../stores/surface";

const NONE: SurfaceInputs = {
  homeOpen: false,
  page: null,
  settingsOpen: false,
  newOpen: false,
  inboxOpen: false,
  searchOpen: false,
  paneCount: 1,
};

const surface = (inputs: Partial<SurfaceInputs>) =>
  surfaceFor({ ...NONE, ...inputs });

test("surfaceFor: the panes", () => {
  assert.equal(surface({}), "session");
  assert.equal(surface({ paneCount: 2 }), "beside");
  assert.equal(surface({ paneCount: 2, mode: "duo-open" }), "beside");
  assert.equal(surface({ paneCount: 2, mode: "desktop" }), "beside");
  // Two panes only sit side by side where there's room
  assert.equal(surface({ paneCount: 2, mode: "duo-closed" }), "session");
  assert.equal(surface({ paneCount: 2, mode: "phone" }), "session");
});

test("surfaceFor: the home", () => {
  assert.equal(surface({ homeOpen: true }), "now");
  assert.equal(surface({ homeOpen: true, paneCount: 2 }), "now");
  // A page over the home is the page
  assert.equal(surface({ homeOpen: true, page: "project" }), "project");
  assert.equal(surface({ homeOpen: true, page: "agent" }), "session");
});

test("surfaceFor: pages", () => {
  assert.equal(surface({ page: "project" }), "project");
  assert.equal(surface({ page: "projectSettings" }), "project");
  assert.equal(surface({ page: "projects" }), "projects");
  assert.equal(surface({ page: "inbox" }), "needs");
  assert.equal(surface({ inboxOpen: true }), "needs");
  assert.equal(surface({ page: "new" }), "new");
  assert.equal(surface({ newOpen: true }), "new");
});

test("surfaceFor: the topmost layer wins", () => {
  const all: Partial<SurfaceInputs> = {
    homeOpen: true,
    page: "project",
    settingsOpen: true,
    newOpen: true,
    inboxOpen: true,
    searchOpen: true,
    paneCount: 2,
  };
  assert.equal(surface(all), "settings");
  assert.equal(surface({ ...all, settingsOpen: false }), "search");
  assert.equal(
    surface({ ...all, settingsOpen: false, searchOpen: false }),
    "new"
  );
  assert.equal(
    surface({ ...all, settingsOpen: false, searchOpen: false, newOpen: false }),
    "project"
  );
  assert.equal(
    surface({ homeOpen: true, page: "projects", inboxOpen: true }),
    "projects"
  );
  assert.equal(surface({ homeOpen: true, inboxOpen: true }), "needs");
});
