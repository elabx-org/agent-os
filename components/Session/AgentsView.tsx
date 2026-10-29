"use client";

import type { Session } from "@/lib/db";

/**
 * The session's agents view (view mode `agents`, alias `workers`): the
 * tree on the closed Duo and phones (N-Tree), tree | detail across the
 * open Duo's pages (O-Tree), graph | detail panel on the desktop (D-Tree).
 * Polls the tree only while shown. Contract stub (U13.2; the desktop
 * branch renders U13.3's AgentGraph).
 */
export function AgentsView({
  className,
}: {
  session: Session;
  /** The view is showing: polls only then */
  active: boolean;
  /** Open a fork's, handoff's or worker's session */
  onOpenSession: (sessionId: string) => void;
  /** Back to the conversation (chat or terminal) the pane showed before */
  onClose: () => void;
  className?: string;
}) {
  return <div aria-label="Agents" className={className} />;
}
