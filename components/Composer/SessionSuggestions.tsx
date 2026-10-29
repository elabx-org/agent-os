"use client";

import type { AttachableSession } from "@/lib/session-attach-types";

/**
 * The @ popover's Sessions tab (N-Attach): rows with avatar, name, status
 * dot · project, "Summary / N tokens" (or "✓ Attached"), and the caption
 * "The agent gets a summary of that session, not its full transcript."
 */
export interface SessionSuggestionsProps {
  /** The composer box points at it (aria-controls) and its options */
  id: string;
  sessions: AttachableSession[];
  /** Already attached: shown checked, a tap detaches */
  attachedIds: string[];
  selected: number;
  onHover: (index: number) => void;
  onToggle: (session: AttachableSession) => void;
  loading?: boolean;
}

export function SessionSuggestions(_props: SessionSuggestionsProps) {
  return null; // M9 U2
}
