import { useQuery } from "@tanstack/react-query";
import type { SubagentInfo } from "@/lib/claude-subagents";

export type SessionSubagent = SubagentInfo & { sessionId: string };

const POLL_MS = 5000;
/** The server caps a request at this many sessions */
const MAX_IDS = 20;

async function fetchSubagents(ids: string[]): Promise<SessionSubagent[]> {
  const res = await fetch(
    `/api/subagents?sessions=${encodeURIComponent(ids.join(","))}`
  );
  if (!res.ok) throw new Error("Failed to fetch subagents");
  return (await res.json()).subagents ?? [];
}

/**
 * The subagents of the given sessions (pass the running and waiting ones):
 * running, or done in the last half hour. Polls only while there are ids.
 */
export function useRunningSubagents(sessionIds: string[]): SessionSubagent[] {
  // Sorted so the same set shares one cache entry
  const ids = [...new Set(sessionIds)].sort().slice(0, MAX_IDS);
  const { data } = useQuery({
    queryKey: ["running-subagents", ids],
    queryFn: () => fetchSubagents(ids),
    enabled: ids.length > 0,
    refetchInterval: ids.length > 0 ? POLL_MS : false,
    placeholderData: (previous) => previous,
  });
  return ids.length > 0 ? (data ?? []) : [];
}
