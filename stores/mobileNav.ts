import { proxy } from "valtio";
import type { SessionStatus } from "@/components/views/types";

export type PaneViewMode = "terminal" | "chat" | "files" | "git" | "workers";

/**
 * Bridges the mobile nav rail (outside the pane tree) and the focused pane,
 * which owns its view mode.
 */
export const mobileNavStore = proxy<{
  /** View mode of the focused pane, mirrored for the rail's selected state */
  viewMode: PaneViewMode;
  /** Pending view change from the rail, consumed by the focused pane */
  request: { mode: PaneViewMode; timestamp: number } | null;
  statuses: Record<string, SessionStatus>;
  /** The rail is showing, so the tab bar drops its own view switcher */
  railActive: boolean;
  inboxOpen: boolean;
  /** Inside the iOS app, which shows the keys on the keyboard itself */
  nativeKeyboard: boolean;
  /** Changed files in the focused session, for the iOS app's Changes badge */
  changes: number;
}>({
  viewMode: "terminal",
  request: null,
  statuses: {},
  railActive: false,
  inboxOpen: false,
  nativeKeyboard: false,
  changes: 0,
});

export const mobileNavActions = {
  requestViewMode: (mode: PaneViewMode) => {
    mobileNavStore.request = { mode, timestamp: Date.now() };
  },
  clearRequest: () => {
    mobileNavStore.request = null;
  },
  setInboxOpen: (open: boolean) => {
    mobileNavStore.inboxOpen = open;
  },
};
