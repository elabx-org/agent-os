"use client";

import type { UseQueue } from "@/hooks/useQueue";

export interface QueueCardProps {
  queue: UseQueue;
  /** "Claude": "Sends when Claude is done. Held while it asks you something." */
  agentName: string;
  /** Lines Claude's own TUI holds (typed in the terminal): read-only rows */
  typedInTerminal?: readonly string[];
  /** Edit: the item's text goes back into the composer */
  onEdit?: (itemId: number, text: string) => void;
}

// M2 contract: props only; U2.4 builds it

/**
 * N-Queue: "2 queued · Saved on the server", dashed purple items with drag,
 * Edit and ×, and the caption. Replaces ClaudeStateBar's QueuedMessages.
 * Renders nothing when there is nothing queued
 */
export function QueueCard(_props: QueueCardProps) {
  return null;
}
