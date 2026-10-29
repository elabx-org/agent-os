"use client";

import { useEffect } from "react";
import type { Session } from "@/lib/db";
import { mobileNavStore } from "@/stores/mobileNav";
import { useAgentTree } from "@/hooks/useAgentTree";
import { useSubagents, useWorkflows } from "@/hooks/useSubagents";
import { cheapAgentCount } from "./agent-tree-format";

/**
 * The column's Agents item and the Live activity's "Agents · N" for the
 * focused pane's session (mobileNavStore.agentCount): the tree's total
 * while the agents view shows (the view's own poll), else the cheap count
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
}): number {
  const id = session?.id ?? "";
  const { tree } = useAgentTree(id, isFocused && agentsShown);
  const cheap = isFocused && !agentsShown && !!id;
  const subagents = useSubagents(id, cheap);
  const workflows = useWorkflows(id, cheap);
  const count = !id
    ? 0
    : agentsShown
      ? (tree?.total ?? mobileNavStore.agentCount)
      : cheapAgentCount(id, subagents, workflows, sessions);
  useEffect(() => {
    if (isFocused) mobileNavStore.agentCount = count;
  }, [isFocused, count]);
  // Focus leaves or the pane closes: no stale count for the next pane
  useEffect(() => {
    if (!isFocused) return;
    return () => {
      mobileNavStore.agentCount = 0;
    };
  }, [isFocused, id]);
  return count;
}
