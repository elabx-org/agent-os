"use client";

import { useEffect } from "react";
import type { Session } from "@/lib/db";
import { mobileNavStore } from "@/stores/mobileNav";
import { useAgentTree } from "@/hooks/useAgentTree";
import { useSubagents, useWorkflows } from "@/hooks/useSubagents";
import {
  cheapAgentCount,
  treeAgentCounts,
  type AgentCounts,
} from "./agent-tree-format";

/**
 * The column's Agents item and the Live activity's "Agents · N" for the
 * focused pane's session (mobileNavStore.agentCount, and agentLive for
 * the number shown): the tree's while the agents view shows (the view's
 * own poll), else the cheap count
 */
export function useAgentCount({
  session,
  sessions,
  isFocused,
  agentsShown,
}: {
  session: Session | null | undefined;
  sessions: readonly Session[];
  isFocused: boolean;
  /** The pane shows its agents view */
  agentsShown: boolean;
}): AgentCounts {
  const id = session?.id ?? "";
  const { tree } = useAgentTree(id, isFocused && agentsShown);
  const cheap = isFocused && !agentsShown && !!id;
  const subagents = useSubagents(id, cheap);
  const workflows = useWorkflows(id, cheap);
  const counts = !id
    ? NO_AGENTS
    : agentsShown
      ? tree
        ? treeAgentCounts(tree)
        : { total: mobileNavStore.agentCount, live: mobileNavStore.agentLive }
      : cheapAgentCount(id, subagents, workflows, sessions);
  const { total, live } = counts;
  // One effect, so a new session's count is written even when it equals
  // the old one's; focus leaving or the pane closing clears it
  useEffect(() => {
    if (!isFocused) return;
    mobileNavStore.agentCount = total;
    mobileNavStore.agentLive = live;
    return () => {
      mobileNavStore.agentCount = 0;
      mobileNavStore.agentLive = 0;
    };
  }, [isFocused, id, total, live]);
  return counts;
}

const NO_AGENTS: AgentCounts = { total: 0, live: 0 };
