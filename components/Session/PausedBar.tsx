"use client";

import type { Session } from "@/lib/db";

/**
 * Where a paused (handed-off) session's composer was: "Paused · handed off
 * to Codex", Open that session, and Resume here (resume-paused, warns when
 * the successor still runs in the same folder)
 */
export interface PausedBarProps {
  session: Session;
  /** Open the session it was handed to */
  onOpenSuccessor?: (sessionId: string) => void;
  className?: string;
}

export function PausedBar(_props: PausedBarProps) {
  return null; // M4 U4
}
