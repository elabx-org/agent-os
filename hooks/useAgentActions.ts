"use client";

import { useQuery } from "@tanstack/react-query";
import { useSharedPoll } from "@/hooks/useSharedPoll";
import type { AgentAction } from "@/lib/agent-actions";

// The prompt's own rate, so a blocked attempt shows within one poll
const ACTIONS_POLL_MS = 2000;
const NONE: AgentAction[] = [];

export const agentActionKeys = {
  session: (sessionId: string, since: number) =>
    ["agent-actions", sessionId, since] as const,
};

async function fetchActions(id: string, since: number): Promise<AgentAction[]> {
  const res = await fetch(`/api/sessions/${id}/agent-actions?since=${since}`);
  if (!res.ok) return NONE;
  return ((await res.json()).actions as AgentAction[] | undefined) ?? NONE;
}

/** What agents tried on this session, newest first, polled while enabled */
export function useAgentActions(
  sessionId: string,
  { enabled = true, since = 0 }: { enabled?: boolean; since?: number } = {}
): { actions: AgentAction[]; isLoading: boolean } {
  const queryKey = agentActionKeys.session(sessionId, since);
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchActions(sessionId, since),
    enabled,
    staleTime: ACTIONS_POLL_MS,
  });
  useSharedPoll(queryKey, ACTIONS_POLL_MS, enabled);
  return { actions: data ?? NONE, isLoading: enabled && isLoading };
}
