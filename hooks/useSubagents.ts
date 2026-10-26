import { useQuery } from "@tanstack/react-query";
import type { SubagentInfo } from "@/lib/claude-subagents";
import { useSharedPoll } from "./useSharedPoll";

const AGENTS_POLL_MS = 3000;

export const subagentKeys = {
  session: (sessionId: string) => ["subagents", sessionId] as const,
};

async function fetchSubagents(sessionId: string): Promise<SubagentInfo[]> {
  const res = await fetch(`/api/sessions/${sessionId}/subagents`);
  if (!res.ok) throw new Error("Failed to fetch subagents");
  return (await res.json()).subagents ?? [];
}

/**
 * The subagents the session has started, by the Agent call that started
 * each. Chat and the activity rail share one poll.
 */
export function useSubagents(sessionId: string, active: boolean) {
  const queryKey = subagentKeys.session(sessionId);
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchSubagents(sessionId),
    enabled: active,
    staleTime: AGENTS_POLL_MS,
  });
  useSharedPoll(queryKey, AGENTS_POLL_MS, active);
  return (active && data) || NONE;
}

// One empty list, so consumers' memos don't rerun on every render
const NONE: SubagentInfo[] = [];
