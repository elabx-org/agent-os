import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropHome,
  homeAfterSwitch,
  setHome,
  surfaceFor,
  surfaceStore,
  type SurfaceInputs,
  type SwitchInputs,
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

test("dropHome: a fold swapping the views keeps Projects (14)", () => {
  const mode = layoutStore.mode;
  layoutStore.mode = "duo-open";
  setHome(true);
  mobileNavStore.homeTab = "projects";
  // The open Duo's view goes, the closed one's comes with the home up
  layoutStore.mode = "duo-closed";
  dropHome();
  assert.equal(surfaceStore.home, false);
  setHome(true);
  assert.equal(mobileNavStore.homeTab, "projects");
  setHome(false);
  assert.equal(mobileNavStore.homeTab, "now");
  layoutStore.mode = mode;
});

const SWITCH: SwitchInputs = {
  narrow: true,
  wasNarrow: true,
  onePage: true,
  onSession: true,
  sessionId: "s1",
  home: false,
  focus: false,
  before: null,
  pageBeside: false,
  homeForPage: false,
  lastPage: "home",
};

const afterSwitch = (inputs: Partial<SwitchInputs>) =>
  homeAfterSwitch({ ...SWITCH, ...inputs });

test("homeAfterSwitch: the phone turning to the web's wide layout and back", () => {
  // Turned wide the sidebar shows, as at start, unless Focus is on
  assert.equal(afterSwitch({ narrow: false, home: false }).home, true);
  assert.equal(afterSwitch({ narrow: false, focus: true }).home, false);
  // Started wide in a session, turned upright: the session, not Now
  assert.equal(afterSwitch({ wasNarrow: false, home: true }).home, false);
  // Now on the phone before the turn comes back (PT-4)
  const before = { home: true, sessionId: "s1" };
  assert.equal(afterSwitch({ wasNarrow: false, before }).home, true);
  // ...unless another session was picked while wide
  assert.equal(
    afterSwitch({ wasNarrow: false, before, sessionId: "s2" }).home,
    false
  );
  // Nothing behind: Now
  assert.equal(afterSwitch({ wasNarrow: false, onSession: false }).home, true);
});

test("homeAfterSwitch: the Duo folding and unfolding keeps what showed (5)", () => {
  // Unfolding from Now or from the session
  assert.deepEqual(afterSwitch({ onePage: false, home: true }), {
    home: true,
    homeForPage: false,
  });
  assert.equal(afterSwitch({ onePage: false }).home, false);
  // Folding from Now on the left, used last
  assert.equal(afterSwitch({ home: true }).home, true);
  assert.equal(afterSwitch({ home: false }).home, false);
  assert.equal(afterSwitch({ onSession: false }).home, true);
});

test("homeAfterSwitch: a page unfolded has Now on the left page (13)", () => {
  assert.deepEqual(afterSwitch({ onePage: false, pageBeside: true }), {
    home: true,
    homeForPage: true,
  });
  // Folded again with the page still open: the page over the session
  assert.equal(
    afterSwitch({ home: true, homeForPage: true, pageBeside: true }).home,
    false
  );
  // The page closed on the open Duo: Now stays
  assert.equal(afterSwitch({ home: true, homeForPage: true }).home, true);
});

test("homeAfterSwitch: folding to one page shows the page used last (DPD-12a)", () => {
  // A file opened on the right page beside Now
  assert.equal(afterSwitch({ home: true, lastPage: "session" }).home, false);
  assert.equal(afterSwitch({ home: true, lastPage: "home" }).home, true);
});
