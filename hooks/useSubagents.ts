import { useQuery } from "@tanstack/react-query";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import { useSharedPoll } from "./useSharedPoll";

const AGENTS_POLL_MS = 3000;

export const subagentKeys = {
  session: (sessionId: string) => ["subagents", sessionId] as const,
};

interface SessionAgents {
  subagents: SubagentInfo[];
  workflows: WorkflowInfo[];
}

async function fetchSubagents(sessionId: string): Promise<SessionAgents> {
  const res = await fetch(`/api/sessions/${sessionId}/subagents`);
  if (!res.ok) throw new Error("Failed to fetch subagents");
  const body = await res.json();
  return { subagents: body.subagents ?? [], workflows: body.workflows ?? [] };
}

function useSessionAgents(sessionId: string, active: boolean) {
  const queryKey = subagentKeys.session(sessionId);
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchSubagents(sessionId),
    enabled: active,
    staleTime: AGENTS_POLL_MS,
  });
  useSharedPoll(queryKey, AGENTS_POLL_MS, active);
  return active ? data : undefined;
}

/**
 * The subagents the session has started, by the Agent call that started
 * each. Chat and the activity rail share one poll.
 */
export function useSubagents(sessionId: string, active: boolean) {
  return useSessionAgents(sessionId, active)?.subagents ?? NONE;
}

/** The session's workflow runs, from the same poll */
export function useWorkflows(sessionId: string, active: boolean) {
  return useSessionAgents(sessionId, active)?.workflows ?? NO_RUNS;
}

// One empty list, so consumers' memos don't rerun on every render
const NONE: SubagentInfo[] = [];
const NO_RUNS: WorkflowInfo[] = [];
