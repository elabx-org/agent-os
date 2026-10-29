"use client";

import type { Session } from "@/lib/db";
import type { AgentTreeResponse, TreeNode } from "@/lib/agent-tree-types";

/**
 * The family tree as an indented list (N-Tree on the closed Duo, O-Tree's
 * left page): the title "Agents · 7" and the counts line, the session's
 * card, then workflows → phases → agents, subagents and forks with guide
 * lines; finished ones hide unless Show finished, branches fold.
 * Contract stub (U13.2).
 */
export function AgentTree({
  className,
}: {
  session: Session;
  tree: AgentTreeResponse | undefined;
  isLoading: boolean;
  /** closed: cards (N-Tree); open: flat rows in one card (O-Tree's left page) */
  variant: "closed" | "open";
  /** The selected node's id (open: its row is ringed); null for none */
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  className?: string;
}) {
  return <div aria-label="Agent tree" className={className} />;
}
