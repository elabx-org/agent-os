import { proxy } from "valtio";
import type { SessionStatus } from "@/components/views/types";

export type PaneViewMode = "terminal" | "files" | "git" | "workers";

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
}>({
  viewMode: "terminal",
  request: null,
  statuses: {},
  railActive: false,
});

export const mobileNavActions = {
  requestViewMode: (mode: PaneViewMode) => {
    mobileNavStore.request = { mode, timestamp: Date.now() };
  },
  clearRequest: () => {
    mobileNavStore.request = null;
  },
};
