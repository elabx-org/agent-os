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
  workspacePageStore,
} from "@/stores/workspacePage";
import { closeNew, newSurfaceStore } from "@/stores/newSurface";
import { openProjectSettings } from "@/stores/projectSettings";
import { surfaceStore } from "@/stores/surface";
import { isNative, postToNative } from "@/lib/native-bridge";

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
  "done",
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
  openNewSession: () => void;
  openSettings: () => void;
  /** Now, never toggled: the home shown (app/page.tsx registers it) */
  openNow: () => void;
  /** The column's back past every layer: Now, unless the page knows better */
  goBack: () => void;
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
  /** Close the sheet over the session (E-Live, N-Undo) */
  closeSheet: () => void;
  /** The column's ✓ under a sheet: apply it (N-PermMode); the sheet registers it */
  confirmSheet: () => void;
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
  openNewSession: () => {},
  openSettings: () => openSettings(),
  openNow: showNow,
  goBack: () => navStore.openNow(),
  // Projects is Now's other half until it has a page of its own (M1b)
  openProjects: () => navStore.openNow(),
  openLive: () => {
    mobileNavStore.liveOpen = !mobileNavStore.liveOpen;
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
  openNotifSettings: () => openSettings("notifications"),
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
  confirmSheet: () => {},
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

/**
 * One level up, topmost layer first as surfaceFor ranks them: a Settings
 * section, Settings, Find, New, a page, Needs you, Projects, else Now
 */
function goBack() {
  if (settingsPageStore.open) {
    if (!settingsBack()) closeSettings();
    return;
  }
  // app/page.tsx's goBack closes Find before anything else
  if (surfaceStore.searchOpen) return navStore.goBack();
  if (newSurfaceStore.open) return closeNew();
  if (workspacePageStore.page) {
    if (workspacePageStore.previous) backPage();
    else navStore.openNow();
    return;
  }
  if (mobileNavStore.inboxOpen) return mobileNavActions.setInboxOpen(false);
  // Projects is Now's other half: back from it is Now
  if (surfaceStore.home && mobileNavStore.homeTab === "projects") {
    mobileNavStore.homeTab = "now";
    return;
  }
  navStore.goBack();
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
  git: () => mobileNavActions.requestViewMode("git"),
  files: () => mobileNavActions.requestViewMode("files"),
  find: () => navStore.openFind(),
  focus: () => toggleFocus(),
  settings: () => navStore.openSettings(),
  sessions: () => navStore.openSessions(),
  back: () => goBack(),
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
  closeSettings: () => closeSettings(),
  projectSettings: () => navStore.openProjectSettings(),
  newProject: () => navStore.openNewProject(),
  start: () => navStore.startNew(),
  stop: () => navStore.stopSession(),
  closeSheet: () => navStore.closeSheet(),
  done: () => navStore.confirmSheet(),
};

/** Actions on or beside Settings: it stays up for them */
const KEEPS_SETTINGS = new Set<NavAction>([
  "settings",
  "focus",
  "back",
  "server",
]);

export function runNav(action: NavAction): void {
  // Settings covers the app: anything else in the column leaves it. Focus
  // only changes what shows around the session, so it keeps Settings up
  if (!KEEPS_SETTINGS.has(action)) closeSettings();
  // A view picked over a workspace page goes back to the session
  const leftPage =
    (action === "chat" ||
      action === "terminal" ||
      action === "git" ||
      action === "files") &&
    closePage();
  NAV_ROUTES[action](leftPage);
}
