/**
 * The control column's actions, one place for every way in: the web column,
 * the iOS app's bar, the session header's back and the shortcuts.
 */

import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { closeSettings, openSettings } from "@/stores/settingsPage";
import { toggleFocus } from "@/stores/focus";
import { closePage } from "@/stores/workspacePage";

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
  | "sessions";

interface NavHandlers {
  openSessions: () => void;
  openFind: () => void;
  openNewSession: () => void;
  openSettings: () => void;
}

/** What app/page.tsx owns (its own state), registered while it is mounted */
export const navStore: NavHandlers = {
  openSessions: () => {},
  openFind: () => {},
  openNewSession: () => {},
  openSettings: () => openSettings(),
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
  }
}
