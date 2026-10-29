"use client";

import type { Session } from "@/lib/db";

export interface NeedsYouCardProps {
  session: Session;
  /**
   * inline: in the conversation (Closed-Chat, Desk-Chat, "Claude is
   * asking"); sheet: the Live activity's "Waiting for your answer" with
   * how long it has waited (E-Live); rail: Desk-Chat's right rail, title only
   */
  variant: "inline" | "sheet" | "rail";
  onOpenTerminal?: () => void;
  onAnswered?: () => void;
  className?: string;
}

// M2 contract: props only; U2.3 builds it

/**
 * The amber card for what the agent waits on: a question's options as
 * pills (primary first), or M0's PermissionCard for a permission. Renders
 * nothing when the session waits on nothing
 */
export function NeedsYouCard(_props: NeedsYouCardProps) {
  return null;
}
