"use client";

import type { Session } from "@/lib/db";
import type { ViewProps } from "@/components/views/types";

export interface DesktopSidebarProps {
  /** Sessions, projects, statuses and the handlers (New, Find, open) */
  view: ViewProps;
  /** The session in the focused pane: its row is .row.sel */
  activeSessionId?: string;
  onOpenSession: (session: Session) => void;
}

/** The sidebar's width (Desk-Chat, D-New) */
export const DESKTOP_SIDEBAR_WIDTH = 270;

/**
 * The desktop's home (Desk-Chat, D-New): the logo and New pill, Find ⌘K,
 * Needs you / Working / Projects (first 5, "N more"), the usage card at
 * the bottom. Only where useLayoutMode() is "desktop". M1b U1b.4.
 */
export function DesktopSidebar(props: DesktopSidebarProps) {
  void props;
  return null;
}
