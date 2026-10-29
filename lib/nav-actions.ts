/**
 * The control column's actions, one place for every way in: the web column,
 * the iOS app's bar, the session header's back and the shortcuts.
 */

import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { closeSettings, openSettings } from "@/stores/settingsPage";
import { toggleFocus } from "@/stores/focus";
import { closePage } from "@/stores/workspacePage";

/**
 * `sessions`, `focus` and `find` are what iOS app 0.1.62 sends: they stay,
 * as aliases of `now`, `live` and `search` (canonicalNav)
 */
export type NavAction =
  | "new"
  | "inbox"
  | "chat"
  | "terminal"
  | "git"
  | "files"
  | "find"
  | "focus"
  | "settings"
  | "sessions"
  | "back"
  | "now"
  | "projects"
  | "search"
  | "live"
  | "beside"
  | "swap"
  | "more"
  | "sort"
  | "clearHistory"
  | "notifSettings"
  | "server"
  | "closeSettings"
  | "projectSettings";

export type LegacyNavAction = "sessions" | "focus" | "find";

export const NAV_ALIASES: Record<LegacyNavAction, NavAction> = {
  sessions: "now",
  focus: "live",
  find: "search",
};

/** The action a legacy name stands for; any other action as it is */
export function canonicalNav(action: NavAction): NavAction {
  // Contract stub: U1.2
  return action;
}

interface NavHandlers {
  openSessions: () => void;
  openFind: () => void;
  openNewSession: () => void;
  openSettings: () => void;
  /** The column's back: the page before, else Now (U1.2 fills the default) */
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
}

/** What app/page.tsx owns (its own state), registered while it is mounted */
export const navStore: NavHandlers = {
  openSessions: () => {},
  openFind: () => {},
  openNewSession: () => {},
  openSettings: () => openSettings(),
  goBack: () => {},
  openProjects: () => {},
  openLive: () => {},
  openBeside: () => {},
  swapPanes: () => {},
  openMore: () => {},
  openSort: () => {},
  clearHistory: () => {},
  openNotifSettings: () => {},
  openServer: () => {},
  openProjectSettings: () => {},
};

export function registerNavHandlers(
  handlers: Partial<NavHandlers>
): () => void {
  const previous = { ...navStore };
  Object.assign(navStore, handlers);
  return () => {
    Object.assign(navStore, previous);
  };
}

export function runNav(action: NavAction): void {
  // Settings covers the app: anything else in the column leaves it. Focus
  // only changes what shows around the session, so it keeps Settings up
  if (action !== "settings" && action !== "focus") closeSettings();
  // A view picked over a workspace page goes back to the session
  const leftPage =
    (action === "chat" ||
      action === "terminal" ||
      action === "git" ||
      action === "files") &&
    closePage();
  switch (action) {
    case "inbox":
      return mobileNavActions.setInboxOpen(true);
    case "sessions":
      return navStore.openSessions();
    case "find":
      return navStore.openFind();
    case "new":
      return navStore.openNewSession();
    case "settings":
      return navStore.openSettings();
    case "focus":
      return toggleFocus();
    // Like the rail: the current view again opens the session list
    case "chat":
    case "terminal":
      return mobileNavStore.viewMode === action && !leftPage
        ? navStore.openSessions()
        : mobileNavActions.requestViewMode(action);
    case "git":
    case "files":
      return mobileNavActions.requestViewMode(action);
    // Contract stubs: U1.2 routes the new actions
    default:
      return;
  }
}
