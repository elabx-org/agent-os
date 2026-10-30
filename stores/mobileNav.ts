import { proxy } from "valtio";
import type { SessionStatus } from "@/components/views/types";

/** `workers` is an alias of `agents` (lib/agent-views.ts canonicalViewMode) */
export type PaneViewMode =
  | "terminal"
  | "chat"
  | "files"
  | "git"
  | "workers"
  | "agents";

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
  /** Which half of the home shows: Now, or Projects until M1b gives it a page */
  homeTab: "now" | "projects";
  /** The column's Live activity: the rail on the open Duo's right page, else a sheet */
  liveOpen: boolean;
  /** The session in view is working (the closed column's Stop, M2) */
  working: boolean;
  /** A sheet over the session other than Live activity (N-Undo M2,
      N-Switch M4, N-PermMode M7, N-Scripts M3) */
  sheet: "undo" | "switch" | "permissions" | "scripts" | "move" | null;
  /** What the move sheet can do now (lib/column-spec.ts sheetAction) */
  sheetAction: "move" | "cancel" | "none";
  /** Agents the focused session started (its tree's total): the column's Agents item */
  agentCount: number;
  /** Those still at work, asking or queued: the number the Agents item shows */
  agentLive: number;
  /**
   * The open Duo's Changes page beside the conversation (Open-Changes, M2b):
   * the column's Changes there opens this instead of the git view
   */
  changesOpen: boolean;
  /** The focused pane's last conversation view, for "Back to session" (E-Git, E-Files) */
  conversationView: "chat" | "terminal";
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
  homeTab: "now",
  liveOpen: false,
  working: false,
  sheet: null,
  sheetAction: "move",
  agentCount: 0,
  agentLive: 0,
  changesOpen: false,
  conversationView: "chat",
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
