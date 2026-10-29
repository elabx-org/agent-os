"use client";

import type { Session } from "@/lib/db";

/**
 * N-Switch "Agent and model": Claude model + effort (between turns, queued
 * as `/model`), and the agent pick, which is a handoff to a new session in
 * the same folder with a summary; this one stays listed, paused.
 */
export interface SwitchSheetProps {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a handoff: open the new session */
  onHandedOff?: (newSession: Session) => void;
}

export function SwitchSheet(_props: SwitchSheetProps) {
  return null; // M4 U3
}
