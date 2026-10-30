import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setHome,
  surfaceFor,
  surfaceStore,
  type SurfaceInputs,
} from "../../stores/surface";
import { mobileNavStore } from "../../stores/mobileNav";
import { layoutStore } from "../../hooks/useLayoutMode";

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
  // Running is its own page, not the session's
  assert.equal(surface({ page: "running" }), "running");
  assert.equal(surface({ page: "running", paneCount: 2 }), "running");
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

test("setHome: Projects picked from a session survives the home opening (9)", () => {
  const mode = layoutStore.mode;
  layoutStore.mode = "duo-closed";
  surfaceStore.home = false;
  mobileNavStore.homeTab = "projects";
  // The view's cleanup before the home opens, then the home
  setHome(false);
  setHome(true);
  assert.equal(mobileNavStore.homeTab, "projects");
  // Closed, it comes back as Now
  setHome(false);
  assert.equal(mobileNavStore.homeTab, "now");
  // The phone keeps its tab
  layoutStore.mode = "phone";
  mobileNavStore.homeTab = "projects";
  setHome(true);
  setHome(false);
  assert.equal(mobileNavStore.homeTab, "projects");
  mobileNavStore.homeTab = "now";
  layoutStore.mode = mode;
});
