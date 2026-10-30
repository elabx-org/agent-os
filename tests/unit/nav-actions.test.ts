import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backTarget,
  canonicalNav,
  NAV_ACTIONS,
  NAV_ROUTES,
  navStore,
  noteOrigin,
  registerNavHandlers,
  registerPageBack,
  registerViewBack,
  resumeView,
  runNav,
  type NavAction,
} from "../../lib/nav-actions";
import { mobileNavStore } from "../../stores/mobileNav";
import { settingsPageStore } from "../../stores/settingsPage";
import { workspacePageStore } from "../../stores/workspacePage";
import { surfaceStore } from "../../stores/surface";
import { focusStore } from "../../stores/focus";
import { layoutStore } from "../../hooks/useLayoutMode";
import { backStore } from "../../stores/back";
import { runningStore } from "../../stores/running";

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
  mobileNavStore.homeTab = "now";
  surfaceStore.home = false;
  surfaceStore.behind = false;
  surfaceStore.searchOpen = false;
  layoutStore.mode = "desktop";
  backStore.origin = null;
  runningStore.sessionId = null;
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
    // A Settings section, then Settings (on one page; split, the list and
    // the section show together, so it just closes)
    reset();
    layoutStore.mode = "duo-closed";
    settingsPageStore.open = true;
    settingsPageStore.detail = true;
    runNav("back");
    assert.equal(settingsPageStore.detail, false);
    assert.equal(settingsPageStore.open, true);
    runNav("back");
    assert.equal(settingsPageStore.open, false);
    layoutStore.mode = "desktop";
    settingsPageStore.open = true;
    settingsPageStore.detail = true;
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

test("runNav: back from Changes or Files is the conversation (15)", () => {
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
    layoutStore.mode = "duo-closed";
    mobileNavStore.viewMode = "files";
    mobileNavStore.conversationView = "chat";
    runNav("back");
    assert.equal(mobileNavStore.request?.mode, "chat");

    // Open too, named for it, not Now
    reset();
    layoutStore.mode = "duo-open";
    mobileNavStore.viewMode = "files";
    mobileNavStore.conversationView = "terminal";
    assert.equal(backTarget().label, "Back to session");
    runNav("back");
    assert.equal(mobileNavStore.request?.mode, "terminal");
    assert.deepEqual(calls, []);

    // On the desktop they're tabs: their back is Now's as before
    reset();
    layoutStore.mode = "desktop";
    mobileNavStore.viewMode = "git";
    runNav("back");
    assert.equal(mobileNavStore.request, null);
    assert.deepEqual(calls, ["goBack"]);
  } finally {
    layoutStore.mode = "desktop";
    stop();
  }
});

test("resumeView: the open Duo's Now steps aside to the conversation (7)", () => {
  assert.equal(resumeView("duo-open", "git", "terminal"), "terminal");
  assert.equal(resumeView("book", "files", "chat"), "chat");
  assert.equal(resumeView("duo-open", "chat", "terminal"), null);
  // One page, or the desktop's tabs: the view stays
  assert.equal(resumeView("duo-closed", "git", "terminal"), null);
  assert.equal(resumeView("desktop", "files", "terminal"), null);
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

test("backTarget: the label says where back goes", () => {
  const { calls, stop } = spyHandlers();
  try {
    reset();
    layoutStore.mode = "duo-closed";
    surfaceStore.behind = true;
    runningStore.sessionId = "s1";
    // From the session, Now
    assert.equal(backTarget().label, "Back to Now");
    // Find over the session goes back to it
    surfaceStore.searchOpen = true;
    assert.equal(backTarget().label, "Back to session");
    // ...and over Now to Now
    surfaceStore.home = true;
    assert.equal(backTarget().label, "Back to Now");
    surfaceStore.searchOpen = false;
    // Now over the session
    assert.equal(backTarget().label, "Back to session");
    // The phone's Projects tab
    mobileNavStore.homeTab = "projects";
    assert.equal(backTarget().label, "Back to Now");
    surfaceStore.home = false;
    assert.equal(backTarget().label, "Back to Projects");
    // Settings: a section, the list
    reset();
    layoutStore.mode = "duo-closed";
    settingsPageStore.open = true;
    settingsPageStore.detail = true;
    assert.equal(backTarget().label, "Back to Settings");
    settingsPageStore.detail = false;
    assert.equal(backTarget().label, "Close settings");
    // The open Duo's panels
    reset();
    layoutStore.mode = "duo-open";
    mobileNavStore.changesOpen = true;
    assert.equal(backTarget().label, "Close Changes");
    assert.deepEqual(calls, []);
  } finally {
    reset();
    stop();
  }
});

test("back: a page over the session goes back to it, over the home to Now", () => {
  const { calls, stop } = spyHandlers();
  try {
    reset();
    layoutStore.mode = "duo-closed";
    surfaceStore.behind = true;
    workspacePageStore.page = { kind: "inbox" };
    assert.equal(backTarget().label, "Back to session");
    runNav("back");
    assert.equal(workspacePageStore.page, null);
    assert.deepEqual(calls, []);

    surfaceStore.home = true;
    workspacePageStore.page = { kind: "running" };
    assert.equal(backTarget().label, "Back to Now");
    runNav("back");
    assert.deepEqual(calls, ["openNow"]);

    // A page opened from another names it
    reset();
    backStore.projectNames = { p1: "agent-os" };
    workspacePageStore.previous = { kind: "project", projectId: "p1" };
    workspacePageStore.page = { kind: "projectSettings", projectId: "p1" };
    assert.equal(backTarget().label, "Back to agent-os");
  } finally {
    reset();
    stop();
  }
});

test("back: a pushed detail goes back first, with its own name", () => {
  const { calls, stop } = spyHandlers();
  try {
    reset();
    workspacePageStore.page = { kind: "running" };
    let closed = 0;
    const unregister = registerPageBack("Back to Running", () => closed++);
    assert.equal(backTarget().label, "Back to Running");
    runNav("back");
    assert.equal(closed, 1);
    assert.equal(workspacePageStore.page?.kind, "running");
    unregister();
    assert.equal(backStore.pageLabel, null);
    assert.notEqual(backTarget().label, "Back to Running");

    // A diff in the closed Changes: its list, then the conversation
    reset();
    layoutStore.mode = "duo-closed";
    mobileNavStore.viewMode = "git";
    mobileNavStore.conversationView = "chat";
    const stopView = registerViewBack("Back to history", () => closed++);
    assert.equal(backTarget().label, "Back to history");
    runNav("back");
    assert.equal(closed, 2);
    assert.equal(mobileNavStore.request?.mode, undefined);
    stopView();
    assert.equal(backTarget().label, "Back to session");
    runNav("back");
    assert.equal(mobileNavStore.request?.mode, "chat");

    // A page over the view goes back before the view's detail
    reset();
    layoutStore.mode = "duo-closed";
    const stopFiles = registerViewBack("Back to files", () => closed++);
    workspacePageStore.page = { kind: "inbox" };
    runNav("back");
    assert.equal(closed, 2);
    assert.deepEqual(calls, ["openNow"]);
    stopFiles();
  } finally {
    reset();
    stop();
  }
});

test("back: Changes and Files on a phone go back to the conversation", () => {
  const { calls, stop } = spyHandlers();
  try {
    for (const mode of ["phone", "tabletop"] as const) {
      reset();
      layoutStore.mode = mode;
      mobileNavStore.viewMode = "files";
      mobileNavStore.conversationView = "terminal";
      assert.equal(backTarget().label, "Back to session", mode);
      runNav("back");
      assert.equal(mobileNavStore.request?.mode, "terminal", mode);
    }
    assert.deepEqual(calls, []);
  } finally {
    reset();
    stop();
  }
});

test("back: a session goes back to the project, Needs you or Find it came from", () => {
  const { calls, stop } = spyHandlers();
  try {
    // From a project page, on one page: the project over the home
    reset();
    layoutStore.mode = "duo-closed";
    backStore.projectNames = { p1: "agent-os" };
    workspacePageStore.page = { kind: "project", projectId: "p1" };
    noteOrigin("s1");
    workspacePageStore.page = null;
    runningStore.sessionId = "s1";
    surfaceStore.behind = true;
    assert.equal(backTarget().label, "Back to agent-os");
    runNav("back");
    assert.deepEqual(calls, ["openNow"]);
    assert.deepEqual(workspacePageStore.page, {
      kind: "project",
      projectId: "p1",
    });
    // Once
    assert.equal(backStore.origin, null);

    // While it attaches, the session it left still shows
    reset();
    runningStore.sessionId = "s0";
    workspacePageStore.page = { kind: "project", projectId: "p1" };
    noteOrigin("s1");
    workspacePageStore.page = null;
    assert.equal(backTarget().label, "Back to agent-os");

    // Another session in view: the origin isn't its
    reset();
    calls.length = 0;
    workspacePageStore.page = { kind: "project", projectId: "p1" };
    noteOrigin("s1");
    workspacePageStore.page = null;
    runningStore.sessionId = "s2";
    assert.equal(backTarget().label, "Back to Now");

    // From Needs you (a page, beside on the open Duo)
    reset();
    calls.length = 0;
    layoutStore.mode = "duo-open";
    workspacePageStore.page = { kind: "inbox" };
    noteOrigin("s1");
    workspacePageStore.page = null;
    runningStore.sessionId = "s1";
    assert.equal(backTarget().label, "Back to Needs you");
    runNav("back");
    assert.equal(mobileNavStore.inboxOpen, true);
    assert.deepEqual(calls, []);

    // From Find: Find again
    reset();
    calls.length = 0;
    surfaceStore.searchOpen = true;
    noteOrigin("s1");
    surfaceStore.searchOpen = false;
    runningStore.sessionId = "s1";
    assert.equal(backTarget().label, "Back to Find");
    runNav("back");
    assert.deepEqual(calls, ["openFind"]);

    // From New, Now: the session is new
    reset();
    workspacePageStore.page = { kind: "new" };
    noteOrigin("s1");
    assert.equal(backStore.origin, null);
  } finally {
    reset();
    stop();
  }
});

test("back: Notification settings from Needs you go back to it", () => {
  const { stop } = spyHandlers();
  try {
    reset();
    stop();
    layoutStore.mode = "duo-closed";
    workspacePageStore.page = { kind: "inbox" };
    runNav("notifSettings");
    assert.equal(settingsPageStore.open, true);
    assert.equal(settingsPageStore.section, "notifications");
    assert.equal(settingsPageStore.returnTo, "needs");
    assert.equal(backTarget().label, "Back to Needs you");
    runNav("back");
    assert.equal(settingsPageStore.open, false);
    assert.equal(mobileNavStore.inboxOpen, true);

    // Close does the same
    reset();
    workspacePageStore.page = { kind: "inbox" };
    runNav("notifSettings");
    runNav("closeSettings");
    assert.equal(settingsPageStore.open, false);
    assert.equal(mobileNavStore.inboxOpen, true);

    // From anywhere else, Settings just closes
    reset();
    runNav("notifSettings");
    assert.equal(settingsPageStore.returnTo, null);
    runNav("closeSettings");
    assert.equal(mobileNavStore.inboxOpen, false);
  } finally {
    reset();
  }
});

test("Find's More: going elsewhere closes Find; More, back, Settings keep it", () => {
  for (const action of NAV_ACTIONS) {
    reset();
    surfaceStore.searchOpen = true;
    const { calls, stop } = spyHandlers();
    runNav(action);
    stop();
    const keeps = [
      "search",
      "find",
      "more",
      "back",
      "focus",
      "settings",
      "server",
      "closeSettings",
    ].includes(action);
    assert.equal(calls.includes("closeFind"), !keeps, action);
  }
  reset();
  const { calls, stop } = spyHandlers();
  runNav("projects");
  stop();
  assert.ok(!calls.includes("closeFind"), "no Find, nothing to close");
});
