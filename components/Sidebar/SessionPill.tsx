"use client";

import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";

export interface SessionPillProps {
  session: Session;
  status?: SessionStatus;
  /** The chevron: pick another session for this side */
  onPick: () => void;
  className?: string;
}

/**
 * Open-Beside: a glass pill floating over each pane, the agent tile, the
 * session's name and its state line ("Needs you" amber, "Working · 6m"
 * green) and a chevron. M1b U1b.4.
 */
export function SessionPill(props: SessionPillProps) {
  void props;
  return null;
}
