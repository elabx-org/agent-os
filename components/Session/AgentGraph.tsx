"use client";

import type { Session } from "@/lib/db";
import type { AgentTreeResponse, TreeNode } from "@/lib/agent-tree-types";

/**
 * The desktop's family tree as a graph (D-Tree): columns Session ·
 * Workflow and subagents · Phases · Agents, hand-rolled SVG curved edges
 * coloured by state (dashed for forks, dotted for queued), the legend,
 * Show finished, and zoom − Fit +. Selecting a card selects the node; the
 * detail panel beside it is AgentDetailPane. Contract stub (U13.3).
 */
export function AgentGraph({
  className,
}: {
  session: Session;
  tree: AgentTreeResponse | undefined;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  className?: string;
}) {
  return <div aria-label="Agent graph" className={className} />;
}
