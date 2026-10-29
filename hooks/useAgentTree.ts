import { useQuery } from "@tanstack/react-query";
import type {
  AgentTreeResponse,
  SubagentDetail,
  TreeNodeStop,
} from "@/lib/agent-tree-types";
import { useSharedPoll } from "./useSharedPoll";

const TREE_POLL_MS = 3000;
const DETAIL_POLL_MS = 3000;

export const agentTreeKeys = {
  tree: (sessionId: string) => ["agent-tree", sessionId] as const,
  detail: (sessionId: string, agentId: string) =>
    ["agent-tree", sessionId, "detail", agentId] as const,
};

async function fetchTree(sessionId: string): Promise<AgentTreeResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/tree`);
  if (!res.ok) throw new Error("Failed to fetch the agent tree");
  return res.json();
}

async function fetchDetail(
  sessionId: string,
  agentId: string
): Promise<SubagentDetail | null> {
  const res = await fetch(
    `/api/sessions/${sessionId}/subagents/${encodeURIComponent(agentId)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch the agent");
  return res.json();
}

/**
 * The session's family tree of agents, polled while `active` (the agents
 * view showing). The tree, the graph and the column share one poll.
 */
export function useAgentTree(
  sessionId: string | undefined,
  active: boolean
): { tree: AgentTreeResponse | undefined; isLoading: boolean } {
  const on = active && !!sessionId;
  const queryKey = agentTreeKeys.tree(sessionId ?? "");
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchTree(sessionId!),
    enabled: on,
    staleTime: TREE_POLL_MS,
    placeholderData: (previous) => previous,
  });
  useSharedPoll(queryKey, TREE_POLL_MS, on);
  return { tree: on ? data : undefined, isLoading: on && isLoading };
}

/** One subagent's detail (O-Tree's right page, D-Tree's panel) */
export function useAgentDetail(
  sessionId: string | undefined,
  agentId: string | null,
  active: boolean
): { detail: SubagentDetail | null | undefined; isLoading: boolean } {
  const on = active && !!sessionId && !!agentId;
  const queryKey = agentTreeKeys.detail(sessionId ?? "", agentId ?? "");
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchDetail(sessionId!, agentId!),
    enabled: on,
    staleTime: DETAIL_POLL_MS,
  });
  useSharedPoll(queryKey, DETAIL_POLL_MS, on);
  return { detail: on ? data : undefined, isLoading: on && isLoading };
}

/** Stop a worker or a background agent (the only ones with a stop API) */
export async function stopTreeNode(stop: TreeNodeStop): Promise<void> {
  const url =
    stop.kind === "worker"
      ? `/api/orchestrate/workers/${encodeURIComponent(stop.id)}`
      : `/api/background-agents/${encodeURIComponent(stop.id)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Couldn't stop it");
  }
}
