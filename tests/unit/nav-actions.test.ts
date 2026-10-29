import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalNav,
  NAV_ACTIONS,
  NAV_ROUTES,
  navStore,
  registerNavHandlers,
  runNav,
  type NavAction,
} from "../../lib/nav-actions";
import { mobileNavStore } from "../../stores/mobileNav";
import { settingsPageStore } from "../../stores/settingsPage";
import { workspacePageStore } from "../../stores/workspacePage";
import { surfaceStore } from "../../stores/surface";
import { focusStore } from "../../stores/focus";
import { layoutStore } from "../../hooks/useLayoutMode";

/** Every handler replaced by one that notes its name */
function spyHandlers() {
  const calls: string[] = [];
  const handlers = Object.fromEntries(
    Object.keys(navStore).map((name) => [name, () => calls.push(name)])
  );
  const stop = registerNavHandlers(handlers);
  return { calls, stop };
}

function reset() {
  settingsPageStore.open = false;
  settingsPageStore.detail = false;
  workspacePageStore.page = null;
  workspacePageStore.previous = null;
  mobileNavStore.inboxOpen = false;
  mobileNavStore.request = null;
  mobileNavStore.viewMode = "terminal";
  mobileNavStore.liveOpen = false;
  mobileNavStore.changesOpen = false;
}

test("every NavAction has a route, and only those", () => {
  assert.deepEqual(Object.keys(NAV_ROUTES).sort(), [...NAV_ACTIONS].sort());
  for (const action of NAV_ACTIONS) {
    reset();
    const { stop } = spyHandlers();
    assert.doesNotThrow(() => runNav(action), action);
    stop();
  }
});

test("canonicalNav: the legacy names, the rest as they are", () => {
  assert.equal(canonicalNav("sessions"), "now");
  assert.equal(canonicalNav("focus"), "live");
  assert.equal(canonicalNav("find"), "search");
  for (const action of NAV_ACTIONS)
    if (!["sessions", "focus", "find"].includes(action))
      assert.equal(canonicalNav(action), action);
});

test("runNav: what iOS app 0.1.62 sends still does what it did", () => {
  const cases: [NavAction, string | (() => boolean)][] = [
    ["sessions", "openSessions"],
    ["find", "openFind"],
    ["settings", "openSettings"],
    ["new", "openNewSession"],
    ["inbox", () => mobileNavStore.inboxOpen],
    ["chat", () => mobileNavStore.request?.mode === "chat"],
    // Changes goes through its handler (the open Duo's page, else the view)
    ["git", "openChanges"],
    ["files", () => mobileNavStore.request?.mode === "files"],
    // The current view again opens the session list
    ["terminal", "openSessions"],
  ];
  for (const [action, expected] of cases) {
    reset();
    const { calls, stop } = spyHandlers();
    runNav(action);
    stop();
    if (typeof expected === "string")
      assert.deepEqual(calls, [expected], action);
    else assert.ok(expected(), action);
  }
  // focus keeps toggling Focus (and leaves Settings up)
  reset();
  settingsPageStore.open = true;
  const before = focusStore.on;
  runNav("focus");
  assert.equal(focusStore.on, !before);
  assert.equal(settingsPageStore.open, true);
  runNav("focus");
});

test("runNav: the new actions reach their handlers", () => {
  const cases: [NavAction, string][] = [
    ["now", "openNow"],
    ["search", "openFind"],
    ["projects", "openProjects"],
    ["live", "openLive"],
    ["beside", "openBeside"],
    ["swap", "swapPanes"],
    ["more", "openMore"],
    ["sort", "openSort"],
    ["clearHistory", "clearHistory"],
    ["notifSettings", "openNotifSettings"],
    ["server", "openServer"],
    ["projectSettings", "openProjectSettings"],
    ["newProject", "openNewProject"],
    ["start", "startNew"],
    ["stop", "stopSession"],
    ["closeSheet", "closeSheet"],
    ["git", "openChanges"],
    ["pull", "gitPull"],
    ["push", "gitPush"],
    ["newPr", "newPullRequest"],
    ["newFile", "newFile"],
    ["upload", "uploadFile"],
  ];
  for (const [action, handler] of cases) {
    reset();
    const { calls, stop } = spyHandlers();
    runNav(action);
    stop();
    assert.deepEqual(calls, [handler], action);
  }
});

test("runNav: back goes one level up", () => {
  const { calls, stop } = spyHandlers();
  try {
    // A Settings section, then Settings
    reset();
    settingsPageStore.open = true;
    settingsPageStore.detail = true;
    runNav("back");
    assert.equal(settingsPageStore.detail, false);
    assert.equal(settingsPageStore.open, true);
    runNav("back");
    assert.equal(settingsPageStore.open, false);

    // A page opened from another goes back to it
    reset();
    workspacePageStore.previous = { kind: "project", projectId: "p" };
    workspacePageStore.page = { kind: "projectSettings", projectId: "p" };
    runNav("back");
    assert.deepEqual(workspacePageStore.page, {
      kind: "project",
      projectId: "p",
    });
    // ...and the first one to Now
    runNav("back");
    assert.deepEqual(calls, ["openNow"]);

    // Needs you as a dialog
    reset();
    mobileNavStore.inboxOpen = true;
    runNav("back");
    assert.equal(mobileNavStore.inboxOpen, false);

    // From the session: the page's own back (Now unless it knows better)
    reset();
    calls.length = 0;
    runNav("back");
    assert.deepEqual(calls, ["goBack"]);
  } finally {
    stop();
  }
});

test("runNav: back from the closed Changes or Files is the conversation", () => {
  const { calls, stop } = spyHandlers();
  try {
    reset();
    layoutStore.mode = "duo-closed";
    mobileNavStore.viewMode = "git";
    mobileNavStore.conversationView = "terminal";
    runNav("back");
    assert.equal(mobileNavStore.request?.mode, "terminal");
    assert.deepEqual(calls, []);

    reset();
    mobileNavStore.viewMode = "files";
    mobileNavStore.conversationView = "chat";
    runNav("back");
    assert.equal(mobileNavStore.request?.mode, "chat");

    // Open, their back is Now's as before
    reset();
    layoutStore.mode = "duo-open";
    mobileNavStore.viewMode = "git";
    runNav("back");
    assert.equal(mobileNavStore.request, null);
    assert.deepEqual(calls, ["goBack"]);
  } finally {
    layoutStore.mode = "desktop";
    stop();
  }
});

test("runNav: Changes without a page beside asks for the git view", () => {
  reset();
  runNav("git");
  assert.equal(mobileNavStore.request?.mode, "git");
});

test("runNav: closeSettings, and Settings leaves for the rest", () => {
  reset();
  settingsPageStore.open = true;
  runNav("closeSettings");
  assert.equal(settingsPageStore.open, false);
  const { stop } = spyHandlers();
  settingsPageStore.open = true;
  runNav("server");
  assert.equal(settingsPageStore.open, true);
  runNav("search");
  assert.equal(settingsPageStore.open, false);
  stop();
});

test("defaults: Projects is Now's other half, Live only opens", () => {
  reset();
  const opened: string[] = [];
  const stop = registerNavHandlers({
    openSessions: () => opened.push("openSessions"),
  });
  surfaceStore.home = false;
  mobileNavStore.homeTab = "now";
  runNav("projects");
  assert.equal(mobileNavStore.homeTab, "projects");
  assert.deepEqual(opened, ["openSessions"]);
  // Already home: just the tab
  surfaceStore.home = true;
  runNav("now");
  assert.equal(mobileNavStore.homeTab, "now");
  assert.deepEqual(opened, ["openSessions"]);
  stop();

  mobileNavStore.liveOpen = false;
  runNav("live");
  assert.equal(mobileNavStore.liveOpen, true);
  // Pressed again it stays: ‹ closes it
  runNav("live");
  assert.equal(mobileNavStore.liveOpen, true);
  mobileNavStore.liveOpen = false;
  surfaceStore.home = false;
});

test("back: a Live or Changes panel closes before anything under it", () => {
  reset();
  const { calls, stop } = spyHandlers();
  const mode = layoutStore.mode;
  layoutStore.mode = "duo-open";
  mobileNavStore.liveOpen = true;
  runNav("back");
  assert.equal(mobileNavStore.liveOpen, false);
  mobileNavStore.changesOpen = true;
  runNav("back");
  assert.equal(mobileNavStore.changesOpen, false);
  assert.deepEqual(calls, []);
  layoutStore.mode = mode;
  stop();
});

test("back: Projects goes back to Now", () => {
  reset();
  const { calls, stop } = spyHandlers();
  surfaceStore.home = true;
  mobileNavStore.homeTab = "now";
  runNav("projects");
  assert.equal(mobileNavStore.homeTab, "projects");
  calls.length = 0;
  runNav("back");
  assert.equal(mobileNavStore.homeTab, "now");
  assert.deepEqual(calls, []);
  stop();
  surfaceStore.home = false;
});

test("back: Find closes before the page under it", () => {
  reset();
  const { calls, stop } = spyHandlers();
  workspacePageStore.page = { kind: "project", projectId: "p1" };
  surfaceStore.searchOpen = true;
  runNav("back");
  assert.deepEqual(calls, ["goBack"]);
  assert.equal(workspacePageStore.page?.kind, "project");
  stop();
  surfaceStore.searchOpen = false;
  workspacePageStore.page = null;
});

test("registerNavHandlers: overlapping registrations undo only their own", () => {
  const original = navStore.openFind;
  const a = () => {};
  const b = () => {};
  const stopA = registerNavHandlers({ openFind: a });
  const stopSwap = registerNavHandlers({ swapPanes: b });
  stopA();
  assert.equal(navStore.openFind, original);
  assert.equal(navStore.swapPanes, b);
  // A later registration isn't undone by an earlier one's cleanup
  const stopA2 = registerNavHandlers({ openFind: a });
  const stopC = registerNavHandlers({ openFind: b });
  stopA2();
  assert.equal(navStore.openFind, b);
  stopC();
  stopSwap();
  navStore.openFind = original;
});

test("back: Now with a session behind it goes back to the session", () => {
  reset();
  const { calls, stop } = spyHandlers();
  surfaceStore.home = true;
  surfaceStore.behind = true;
  mobileNavStore.homeTab = "now";
  runNav("back");
  assert.deepEqual(calls, ["resume"]);
  surfaceStore.home = false;
  surfaceStore.behind = false;
  stop();
});
