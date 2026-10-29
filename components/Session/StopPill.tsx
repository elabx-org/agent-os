"use client";

import type { Session } from "@/lib/db";

export interface StopPillProps {
  session: Session;
  className?: string;
}

// M2 contract: props only; U2.5 builds it

/**
 * Fold-Chat's "■ Stop" pill beside the composer, while the agent works:
 * interrupts it (POST /api/sessions/[id]/interrupt). Nothing while idle
 */
export function StopPill(_props: StopPillProps) {
  return null;
}
