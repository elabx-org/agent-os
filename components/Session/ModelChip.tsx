"use client";

import type { Session } from "@/lib/db";

/**
 * The header chip "[C] Claude · Opus 5.5 ⌄" (N-Switch) that opens the
 * SwitchSheet; the model from readClaudeState().status.model when live,
 * else sessions.model
 */
export interface ModelChipProps {
  session: Session;
  open: boolean;
  onOpen: () => void;
  className?: string;
}

export function ModelChip(_props: ModelChipProps) {
  return null; // M4 U3
}
