"use client";

import type { AttachableSession } from "@/lib/session-attach-types";

export interface UseAttachableSessions {
  /** Most recent first, filtered by `query` (name or project) */
  sessions: AttachableSession[];
  loading: boolean;
}

/**
 * The @ popover's Sessions tab (N-Attach): every session but `currentId`,
 * running, paused or settled, with its status, project and summary size
 */
export function useAttachableSessions(
  _currentId: string | null,
  _query: string,
  _enabled: boolean
): UseAttachableSessions {
  return { sessions: [], loading: false }; // M9 U2
}
