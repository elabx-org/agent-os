"use client";

import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";

export interface AvatarRailProps {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  /** Sessions showing in a pane: ringed in the accent */
  shownIds: string[];
  onOpenSession: (session: Session) => void;
  onNewSession: () => void;
}

/** The rail's width (Desk-Beside) */
export const AVATAR_RAIL_WIDTH = 72;

/**
 * Desk-Beside: the sidebar collapsed while two panes are open. New on
 * top, one agent tile per live session with its state dot, Settings at
 * the bottom. M1b U1b.4.
 */
export function AvatarRail(props: AvatarRailProps) {
  void props;
  return null;
}
