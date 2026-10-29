"use client";

import type { AttachedSession } from "@/lib/session-attach-types";

/** N-Attach chip in the composer's attachments row: "@ Name (summary) ×" */
export interface SessionAttachChipProps {
  session: AttachedSession;
  onRemove: (sessionId: string) => void;
}

export function SessionAttachChip(_props: SessionAttachChipProps) {
  return null; // M9 U2
}
