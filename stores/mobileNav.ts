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
  /**
   * Pending view change from the rail, consumed by the focused pane. With a
   * sessionId it waits until the pane has attached that session.
   */
  request: { mode: PaneViewMode; timestamp: number; sessionId?: string } | null;
  statuses: Record<string, SessionStatus>;
  /** The rail is showing, so the tab bar drops its own view switcher */
  railActive: boolean;
  /** The web rail's width, for layers that must stop short of it */
  railWidth: number;
  inboxOpen: boolean;
  /** Inside the iOS app, which shows the keys on the keyboard itself */
  nativeKeyboard: boolean;
  /** Changed files in the focused session, for the iOS app's Changes badge */
  changes: number;
  /** Waiting sessions (not workers) plus blocked agents: useNeedsYou's count */
  needsYou: number;
  /** The live activity rail shows beside the pane, so the strip stays away */
  railShown: boolean;
  /** The home covers the pane (phones), so no view is selected */
  homeOpen: boolean;
}>({
  viewMode: "terminal",
  request: null,
  statuses: {},
  railActive: false,
  railWidth: 0,
  inboxOpen: false,
  nativeKeyboard: false,
  changes: 0,
  needsYou: 0,
  railShown: false,
  homeOpen: false,
});

export const mobileNavActions = {
  requestViewMode: (mode: PaneViewMode, sessionId?: string) => {
    mobileNavStore.request = { mode, timestamp: Date.now(), sessionId };
  },
  clearRequest: () => {
    mobileNavStore.request = null;
  },
  setInboxOpen: (open: boolean) => {
    mobileNavStore.inboxOpen = open;
  },
};
