"use client";

import type { Session } from "@/lib/db";

/**
 * Where a settled session's composer was: "Settled · PR #106 merged" and
 * Resume (DELETE settle: relaunches Claude with --resume)
 */
export interface SettledBarProps {
  session: Session;
  className?: string;
}

export function SettledBar(_props: SettledBarProps) {
  return null; // M8 U4
}
