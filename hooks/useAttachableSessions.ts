"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery } from "@/data/projects";
import { statusKeys } from "@/data/sessions/keys";
import type { SessionStatus } from "@/components/views/types";
import { dbTimeMs } from "@/lib/agent-state";
import type { AttachableSession } from "@/lib/session-attach-types";
import {
  SUMMARY_ROWS,
  attachableStatus,
  filterAttachable,
  type StatusFields,
} from "@/components/Composer/attach-model";
import { sessionSummaryQuery } from "./useSessionSummary";

export interface UseAttachableSessions {
  /** Most recent first, filtered by `query` (name or project) */
  sessions: AttachableSession[];
  loading: boolean;
}

async function fetchStatuses(): Promise<{
  statuses: Record<string, SessionStatus>;
}> {
  const res = await fetch("/api/sessions/status");
  if (!res.ok) throw new Error("Failed to fetch statuses");
  return res.json();
}

/**
 * The @ popover's Sessions tab (N-Attach): every session but `currentId`,
 * running, paused or settled, with its status, project and summary size
 */
export function useAttachableSessions(
  currentId: string | null,
  query: string,
  enabled: boolean,
  /** Shown first, so their checked rows are in view */
  attachedIds: readonly string[] = []
): UseAttachableSessions {
  const attachedKey = attachedIds.join(",");
  const { data, isLoading } = useSessionsQuery();
  const { data: projects } = useProjectsQuery();
  // The statuses everyone polls (data/statuses): read from the same cache
  const { data: statusData } = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
    enabled,
  });

  const rows = useMemo(() => {
    if (!enabled) return [];
    const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
    const statuses = statusData?.statuses ?? {};
    const now = Date.now();
    const all: AttachableSession[] = (data?.sessions ?? []).map((s) => {
      const updated = dbTimeMs(s.updated_at || s.created_at);
      return {
        id: s.id,
        name: s.name,
        agentType: s.agent_type || "claude",
        projectName: (s.project_id && projectName.get(s.project_id)) || null,
        status: attachableStatus(
          s as StatusFields,
          statuses[s.id]?.status,
          now
        ),
        tokens: null,
        updatedAt: Number.isNaN(updated) ? 0 : updated,
      };
    });
    return filterAttachable(
      all,
      currentId,
      query,
      undefined,
      attachedKey ? attachedKey.split(",") : []
    );
  }, [enabled, data, projects, statusData, currentId, query, attachedKey]);

  // Sizes only for the rows first in view; a failed or missing summary
  // just shows no count
  const summaries = useQueries({
    queries: rows
      .slice(0, SUMMARY_ROWS)
      .map((r) => sessionSummaryQuery(r.id, enabled)),
  });
  const tokensKey = summaries.map((q) => q.data?.tokens ?? "").join(",");

  const sessions = useMemo(
    () =>
      rows.map((r, i) => {
        const tokens = summaries[i]?.data?.tokens;
        return typeof tokens === "number" ? { ...r, tokens } : r;
      }),
    // summaries is new each render; its key says when a size arrived
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, tokensKey]
  );

  return { sessions, loading: enabled && isLoading };
}
