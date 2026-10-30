/**
 * The control column's actions, one place for every way in: the web column,
 * the iOS app's bar, the session header's back and the shortcuts.
 */

import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import {
  closeSettings,
  openSettings,
  settingsBack,
  settingsPageStore,
} from "@/stores/settingsPage";
import { toggleFocus } from "@/stores/focus";
import {
  backPage,
  closePage,
  openPage,
  workspacePageStore,
  type WorkspacePage,
} from "@/stores/workspacePage";
import { runningStore } from "@/stores/running";
import { closeNew, newSurfaceStore } from "@/stores/newSurface";
import { openProjectSettings } from "@/stores/projectSettings";
import { openScripts } from "@/stores/scriptsSheet";
import { currentSurface, surfaceStore, type Surface } from "@/stores/surface";
import {
  agentTreeStore,
  toggleAllCollapsed,
  toggleShowFinished,
} from "@/stores/agentTree";
import { backStore, setOrigin, type BackOrigin } from "@/stores/back";
import { isNative, postToNative } from "@/lib/native-bridge";
import { WIDE } from "@/lib/column-spec";
import { layoutStore } from "@/hooks/useLayoutMode";

/** Every action, for the routes table and its test */
export const NAV_ACTIONS = [
  "new",
  "inbox",
  "chat",
  "terminal",
  "git",
  "files",
  "find",
  "focus",
  "settings",
  "sessions",
  "back",
  "now",
  "projects",
  "search",
  "live",
  "beside",
  "swap",
  "more",
  "sort",
  "clearHistory",
  "notifSettings",
  "server",
  "closeSettings",
  "projectSettings",
  "newProject",
  "start",
  "stop",
  "closeSheet",
  "scripts",
  "viewConfig",
  "done",
  "agents",
  "showFinished",
  "collapseAll",
  "resume",
  "pull",
  "push",
  "newPr",
  "newFile",
  "upload",
  "running",
  "settle",
  "copyId",
] as const;

/**
 * `sessions`, `focus` and `find` are what iOS app 0.1.62 sends: they stay,
 * as aliases of `now`, `live` and `search` (canonicalNav)
 */
export type NavAction = (typeof NAV_ACTIONS)[number];

export type LegacyNavAction = "sessions" | "focus" | "find";

export const NAV_ALIASES: Record<LegacyNavAction, NavAction> = {
  sessions: "now",
  focus: "live",
  find: "search",
};

/** The action a legacy name stands for; any other action as it is */
export function canonicalNav(action: NavAction): NavAction {
  return action in NAV_ALIASES
    ? NAV_ALIASES[action as LegacyNavAction]
    : action;
}

/** Window event the web column's ⋯ listens for (navStore.openMore's default) */
export const MORE_EVENT = "agentos-more";

interface NavHandlers {
  openSessions: () => void;
  openFind: () => void;
  /** Close Find, showing what was under it */
  closeFind: () => void;
  openNewSession: () => void;
  openSettings: () => void;
  /** Now, never toggled: the home shown (app/page.tsx registers it) */
  openNow: () => void;
  /** The column's back past every layer: Now, unless the page knows better */
  goBack: () => void;
  /** From Now back to the session behind it (the closed Duo, phones) */
  resume: () => void;
  openProjects: () => void;
  /** The live activity sheet (the session's activity rail) */
  openLive: () => void;
  /** Open the focused session's neighbour beside it (open Duo, desktop) */
  openBeside: () => void;
  /** Swap the two panes without remounting them (M1b registers it) */
  swapPanes: () => void;
  /** The ⋯ menu of the current surface */
  openMore: () => void;
  /** Projects: edit order and groups (M1b) */
  openSort: () => void;
  /** Needs you: clear the notification history (M1b) */
  clearHistory: () => void;
  openNotifSettings: () => void;
  /** Settings → Server: the iOS app's server screen */
  openServer: () => void;
  openProjectSettings: () => void;
  /** Projects' + (E-Projects): a new project, not a session (M1b) */
  openNewProject: () => void;
  /** New's ✓ (E-New): start what the form holds; the form registers it */
  startNew: () => void;
  /** Interrupt the session in view (N-Queue's Stop); the pane registers it */
  stopSession: () => void;
  /** Close the sheet over the session (E-Live, N-Undo, N-Scripts) */
  closeSheet: () => void;
  /** The project's Scripts sheet (N-Config's ▷, M3) */
  openScripts: () => void;
  /** Project settings' .agent-os.json (N-Config's <>, M3); the page
      registers it */
  viewConfig: () => void;
  /** The column's ✓ under a sheet: apply it (N-PermMode); the sheet registers it */
  confirmSheet: () => void;
  /**
   * The column's Changes: the git view, unless the open Duo's spread shows
   * Changes as a page beside the conversation (Open-Changes registers it)
   */
  openChanges: () => void;
  /** E-Git's column: Pull, Push, New pull request (the git view registers them) */
  gitPull: () => void;
  gitPush: () => void;
  newPullRequest: () => void;
  /** E-Files' column: New file, Upload (the files view registers them) */
  newFile: () => void;
  uploadFile: () => void;
  /** More's Settle and Copy session ID: the focused session's title bar
      registers them */
  settleSession: () => void;
  copySessionId: () => void;
}

/**
 * Now from the stores alone, until app/page.tsx registers its own: the page
 * over the home closes, then the home shows unless it already does
 */
function showNow() {
  closePage();
  if (!surfaceStore.home) navStore.openSessions();
}

/** Now or Projects: New and Needs you (a dialog on the web) step aside */
function leaveForHome(tab: "now" | "projects") {
  closeNew();
  mobileNavActions.setInboxOpen(false);
  mobileNavStore.homeTab = tab;
}

/** What app/page.tsx owns (its own state), registered while it is mounted */
export const navStore: NavHandlers = {
  openSessions: () => {},
  openFind: () => {},
  closeFind: () => {},
  openNewSession: () => {},
  openSettings: () => openSettings(),
  openNow: showNow,
  goBack: () => navStore.openNow(),
  resume: () => {},
  // Projects is Now's other half until it has a page of its own (M1b)
  openProjects: () => navStore.openNow(),
  // Opens, never toggles: ‹, the panel's × or a swipe closes it
  openLive: () => {
    mobileNavStore.liveOpen = true;
  },
  // Pick the session to put beside it
  openBeside: () => navStore.openFind(),
  swapPanes: () => {},
  openMore: () => {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(MORE_EVENT));
  },
  openSort: () => {},
  clearHistory: () => {},
  // From Needs you, back from them returns there
  openNotifSettings: () =>
    openSettings(
      "notifications",
      currentSurface() === "needs" ? "needs" : undefined
    ),
  openServer: () => {
    if (isNative()) postToNative({ type: "server" });
  },
  openProjectSettings: () => {
    const page = workspacePageStore.page;
    if (page?.kind === "project") openProjectSettings(page.projectId);
  },
  openNewProject: () => navStore.openNewSession(),
  startNew: () => {},
  stopSession: () => {},
  closeSheet: () => {
    mobileNavStore.liveOpen = false;
    mobileNavStore.sheet = null;
  },
  openScripts: () => {
    const page = workspacePageStore.page;
    if (page?.kind === "project" || page?.kind === "projectSettings")
      openScripts(page.projectId);
  },
  viewConfig: () => {},
  confirmSheet: () => {},
  openChanges: () => mobileNavActions.requestViewMode("git"),
  gitPull: () => {},
  gitPush: () => {},
  newPullRequest: () => {},
  newFile: () => {},
  uploadFile: () => {},
  settleSession: () => {},
  copySessionId: () => {},
};

/**
 * Sets some handlers; the returned cleanup puts back only those, and only
 * while they are still the ones set (registrations may overlap)
 */
export function registerNavHandlers(
  handlers: Partial<NavHandlers>
): () => void {
  const keys = Object.keys(handlers) as (keyof NavHandlers)[];
  const previous: Partial<NavHandlers> = {};
  for (const k of keys) previous[k] = navStore[k];
  Object.assign(navStore, handlers);
  return () => {
    for (const k of keys)
      if (navStore[k] === handlers[k]) navStore[k] = previous[k]!;
  };
}

/** A pushed detail's own back: a workspace page's, or the session view's */
let pageBack: (() => void) | null = null;
let viewBack: (() => void) | null = null;

/**
 * While a workspace page shows a pushed detail (a preview, a sheet), back
 * closes it first and says so; the returned cleanup clears it while still set
 */
export function registerPageBack(label: string, back: () => void): () => void {
  pageBack = back;
  backStore.pageLabel = label;
  return () => {
    if (pageBack !== back) return;
    pageBack = null;
    backStore.pageLabel = null;
  };
}

/** The same for the focused session's git or files view (a diff, a file) */
export function registerViewBack(label: string, back: () => void): () => void {
  viewBack = back;
  backStore.viewLabel = label;
  return () => {
    if (viewBack !== back) return;
    viewBack = null;
    backStore.viewLabel = null;
  };
}

/** Where Back goes and what it's called, for every way of going back */
export interface BackTarget {
  label: string;
  go: () => void;
}

/** A page as Back names it */
function pageName(page: WorkspacePage): string {
  switch (page.kind) {
    case "project":
      return backStore.projectNames[page.projectId] ?? "project";
    case "projectSettings":
      return "project settings";
    case "inbox":
      return "Needs you";
    case "running":
      return "Running";
    case "new":
      return "New session";
    case "agent":
      return "agent";
  }
}

/** A surface as Back names it */
function surfaceName(surface: Surface): string {
  switch (surface) {
    case "session":
    case "beside":
      return "session";
    case "project": {
      const page = workspacePageStore.page;
      return page ? pageName(page) : "project";
    }
    case "projects":
      return "Projects";
    case "needs":
      return "Needs you";
    case "new":
      return "New session";
    case "settings":
      return "Settings";
    case "running":
      return "Running";
    case "now":
    case "search":
      return "Now";
  }
}

/** The home as Back shows it: the phone keeps its Projects tab */
function homeTarget(): BackTarget {
  return {
    label:
      mobileNavStore.homeTab === "projects"
        ? "Back to Projects"
        : "Back to Now",
    go: () => navStore.goBack(),
  };
}

function originName(from: BackOrigin): string {
  if (from.kind === "search") return "Find";
  if (from.kind === "needs") return "Needs you";
  return pageName(from.page);
}

/** Back to where the session was opened from */
function reopen(from: BackOrigin) {
  backStore.origin = null;
  if (from.kind === "search") return navStore.openFind();
  // On one page it opens over the home again, so its own back is the home's
  if (!WIDE.includes(layoutStore.mode)) navStore.openNow();
  // Needs you is a page or the desktop's dialog: inboxOpen opens either
  if (from.kind === "needs" || from.page.kind === "inbox")
    return mobileNavActions.setInboxOpen(true);
  openPage(from.page);
}

/** Leave Settings: for Needs you when it was opened from there */
function leaveSettings() {
  const returnTo = settingsPageStore.returnTo;
  closeSettings();
  if (returnTo === "needs") mobileNavActions.setInboxOpen(true);
}

/**
 * One level up, topmost layer first as surfaceFor ranks them: a Settings
 * section, Settings, Find, New, a page, Needs you, Projects, Now over a
 * session; in a session a pushed detail, Changes or Files on one page, then
 * where the session was opened from, else Now. The column's label, the
 * headers' and the iOS app's back, a swipe and Esc all go by it
 */
export function backTarget(): BackTarget {
  const mode = layoutStore.mode;
  const wide = WIDE.includes(mode);
  // A panel on the right page or the Live sheet is the top layer
  if (
    mode !== "desktop" &&
    (mobileNavStore.liveOpen || mobileNavStore.changesOpen)
  )
    return {
      label: mobileNavStore.liveOpen ? "Close live activity" : "Close Changes",
      go: () => {
        mobileNavStore.liveOpen = false;
        mobileNavStore.changesOpen = false;
      },
    };
  if (settingsPageStore.open) {
    // Opened on a section from Needs you, it goes back there; split
    // (list | section), there's no level between
    if (settingsPageStore.returnTo === "needs")
      return { label: "Back to Needs you", go: leaveSettings };
    if (settingsPageStore.detail && !wide)
      return { label: "Back to Settings", go: () => settingsBack() };
    return { label: "Close settings", go: leaveSettings };
  }
  // app/page.tsx's goBack closes Find, showing what was under it
  if (surfaceStore.searchOpen)
    return {
      label: `Back to ${surfaceName(currentSurface({ searchOpen: false }))}`,
      go: () => navStore.goBack(),
    };
  if (newSurfaceStore.open) return { label: "Cancel", go: closeNew };
  const page = workspacePageStore.page;
  if (page) {
    if (pageBack && backStore.pageLabel)
      return { label: backStore.pageLabel, go: pageBack };
    const previous = workspacePageStore.previous;
    if (previous)
      return { label: `Back to ${pageName(previous)}`, go: backPage };
    // Opened over the session (New, Needs you, Running from its column),
    // back to it; over the home, or with no session, the home
    if (surfaceStore.behind && (wide || !surfaceStore.home))
      return { label: "Back to session", go: () => void closePage() };
    return { ...homeTarget(), go: () => navStore.openNow() };
  }
  if (mobileNavStore.inboxOpen)
    return {
      label: `Back to ${surfaceName(currentSurface({ inboxOpen: false }))}`,
      go: () => mobileNavActions.setInboxOpen(false),
    };
  // Projects is Now's other half: back from it is Now
  if (surfaceStore.home && mobileNavStore.homeTab === "projects")
    return {
      label: "Back to Now",
      go: () => {
        mobileNavStore.homeTab = "now";
      },
    };
  // Now over (or beside) a session: back to it
  if (surfaceStore.home && surfaceStore.behind)
    return { label: "Back to session", go: () => navStore.resume() };
  // A diff, a commit or an open file goes back to its list first
  if (viewBack && backStore.viewLabel)
    return { label: backStore.viewLabel, go: viewBack };
  const view = mobileNavStore.viewMode;
  // The agents view registers its own goBack (components/Session/AgentsView)
  if ((view === "agents" || view === "workers") && mode !== "desktop")
    return {
      label:
        mode !== "duo-closed"
          ? "Back to session"
          : agentTreeStore.detailOpen
            ? "Back to agents"
            : "Back to live activity",
      go: () => navStore.goBack(),
    };
  // On one page Changes and Files go back to the conversation (E-Git,
  // E-Files); beside it they're pages of their own
  if (!wide && (view === "git" || view === "files"))
    return {
      label: "Back to session",
      go: () =>
        mobileNavActions.requestViewMode(mobileNavStore.conversationView),
    };
  // Opened from a project, Needs you or Find: back there, also while it
  // attaches (the one it left, or none, still in view with the home away)
  const origin = backStore.origin;
  const inView = runningStore.sessionId;
  if (
    origin &&
    (inView === origin.sessionId ||
      (inView === origin.left && (inView !== null || !surfaceStore.home)))
  ) {
    const { from } = origin;
    return { label: `Back to ${originName(from)}`, go: () => reopen(from) };
  }
  return homeTarget();
}

function goBack() {
  backTarget().go();
}

/**
 * A session is opening: what it opens from (Find, a page but New, Needs
 * you) is where its back returns; from anywhere else, its back is Now's
 */
export function noteOrigin(sessionId: string): void {
  const page = workspacePageStore.page;
  setOrigin(
    sessionId,
    surfaceStore.searchOpen
      ? { kind: "search" }
      : page && page.kind !== "new"
        ? { kind: "page", page: { ...page } }
        : mobileNavStore.inboxOpen
          ? { kind: "needs" }
          : null,
    runningStore.sessionId
  );
}

// Like the rail: the current view again opens the session list
function showView(mode: "chat" | "terminal", leftPage: boolean) {
  return mobileNavStore.viewMode === mode && !leftPage
    ? navStore.openSessions()
    : mobileNavActions.requestViewMode(mode);
}

/**
 * Every action's route. `sessions` keeps toggling the home and `focus` keeps
 * toggling Focus, as iOS app 0.1.62's buttons always did; the new column
 * sends `now` and `live` instead
 */
export const NAV_ROUTES: Record<NavAction, (leftPage: boolean) => void> = {
  new: () => navStore.openNewSession(),
  inbox: () => mobileNavActions.setInboxOpen(true),
  chat: (leftPage) => showView("chat", leftPage),
  terminal: (leftPage) => showView("terminal", leftPage),
  git: () => navStore.openChanges(),
  files: () => mobileNavActions.requestViewMode("files"),
  find: () => navStore.openFind(),
  focus: () => toggleFocus(),
  settings: () => navStore.openSettings(),
  sessions: () => navStore.openSessions(),
  back: () => goBack(),
  resume: () => navStore.resume(),
  now: () => {
    leaveForHome("now");
    navStore.openNow();
  },
  projects: () => {
    leaveForHome("projects");
    navStore.openProjects();
  },
  search: () => navStore.openFind(),
  live: () => navStore.openLive(),
  beside: () => navStore.openBeside(),
  swap: () => navStore.swapPanes(),
  more: () => navStore.openMore(),
  sort: () => navStore.openSort(),
  clearHistory: () => navStore.clearHistory(),
  notifSettings: () => navStore.openNotifSettings(),
  server: () => navStore.openServer(),
  closeSettings: () => leaveSettings(),
  projectSettings: () => navStore.openProjectSettings(),
  newProject: () => navStore.openNewProject(),
  start: () => navStore.startNew(),
  stop: () => navStore.stopSession(),
  closeSheet: () => navStore.closeSheet(),
  scripts: () => navStore.openScripts(),
  viewConfig: () => navStore.viewConfig(),
  done: () => navStore.confirmSheet(),
  agents: () => mobileNavActions.requestViewMode("agents"),
  showFinished: () => toggleShowFinished(),
  collapseAll: () => toggleAllCollapsed(),
  pull: () => navStore.gitPull(),
  push: () => navStore.gitPush(),
  newPr: () => navStore.newPullRequest(),
  newFile: () => navStore.newFile(),
  upload: () => navStore.uploadFile(),
  settle: () => navStore.settleSession(),
  copyId: () => navStore.copySessionId(),
  // M16, behind Labs: what sessions left running, with a preview
  // From a session, what it started; elsewhere everything
  running: () => {
    if (!runningStore.enabled) return;
    const surface = currentSurface();
    const sessionId =
      (surface === "session" || surface === "beside") && runningStore.sessionId;
    openPage(sessionId ? { kind: "running", sessionId } : { kind: "running" });
  },
};

/** Actions on or beside Settings: it stays up for them */
const KEEPS_SETTINGS = new Set<NavAction>([
  "settings",
  "focus",
  "back",
  "server",
  // Closes it itself, back to Needs you when it came from there
  "closeSettings",
]);

/** Actions on or over Find: it stays up for them (Settings opens over it) */
const KEEPS_FIND = new Set<NavAction>([
  "search",
  "find",
  "more",
  "back",
  "focus",
  "settings",
  "server",
  "closeSettings",
]);

export function runNav(action: NavAction): void {
  // Settings covers the app: anything else in the column leaves it. Focus
  // only changes what shows around the session, so it keeps Settings up
  if (!KEEPS_SETTINGS.has(action)) closeSettings();
  // Find's More goes somewhere else: Find closes rather than stay on top
  if (surfaceStore.searchOpen && !KEEPS_FIND.has(action)) navStore.closeFind();
  // A view picked over a workspace page goes back to the session
  const leftPage =
    (action === "chat" ||
      action === "terminal" ||
      action === "git" ||
      action === "files" ||
      action === "agents") &&
    closePage();
  NAV_ROUTES[action](leftPage);
}
