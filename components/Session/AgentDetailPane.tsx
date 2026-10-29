"use client";

import type { Session } from "@/lib/db";
import type { TreeNode } from "@/lib/agent-tree-types";

/**
 * One agent in detail (O-Tree's right page, D-Tree's panel): the crumb,
 * its avatar, title and state line, "Asked to", the last four tool calls,
 * the files it wrote, the context bar, and Open transcript; Stop agent only
 * when the node has a stop API (workers, background agents), Message agent
 * (panel) only for a session it can open. Contract stub (U13.2).
 */
export function AgentDetailPane({
  className,
}: {
  session: Session;
  node: TreeNode;
  /** crumbsFor(tree, node.id) */
  crumbs: string[];
  /** page: the open Duo's right page; panel: the desktop's right panel */
  variant: "page" | "panel";
  onOpenTranscript: (node: TreeNode) => void;
  /** Opens a fork's, handoff's or worker's own session */
  onOpenSession?: (sessionId: string) => void;
  className?: string;
}) {
  return <section aria-label="Selected agent" className={className} />;
}
