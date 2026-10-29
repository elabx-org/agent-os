"use client";

import type { AgentAction } from "@/lib/agent-actions";

/** What agents tried on this session, newest first, polled while enabled */
export function useAgentActions(
  _sessionId: string,
  _options: { enabled?: boolean; since?: number } = {}
): { actions: AgentAction[]; isLoading: boolean } {
  return { actions: [], isLoading: false };
}
