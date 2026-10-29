"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import { ChevronLeft } from "lucide-react";
import type { Session } from "@/lib/db";
import type { AgentTreeResponse, TreeNode } from "@/lib/agent-tree-types";
import { crumbsFor, findNode } from "@/lib/agent-tree-view";
import { registerNavHandlers } from "@/lib/nav-actions";
import { cn } from "@/lib/utils";
import { useAgentTree } from "@/hooks/useAgentTree";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { mobileNavActions, mobileNavStore } from "@/stores/mobileNav";
import { openSubagent } from "@/stores/agentOpen";
import { agentTreeStore, selectNode, setDetailOpen } from "@/stores/agentTree";
import { AgentTree } from "./AgentTree";
import { AgentDetailPane } from "./AgentDetailPane";
import { AgentGraph } from "./AgentGraph";
import { defaultSelection, hasDetail, opensSession } from "./agent-tree-format";

/** The picked node while it's still in the tree, else the default one */
function selectedNode(
  tree: AgentTreeResponse | undefined,
  picked: string | null | undefined
): TreeNode | null {
  if (!tree) return null;
  const id =
    (picked && findNode(tree, picked) ? picked : null) ??
    defaultSelection(tree);
  return id ? (findNode(tree, id)?.node ?? null) : null;
}

/**
 * The session's agents view (view mode `agents`, alias `workers`): the
 * tree on the closed Duo and phones (N-Tree), tree | detail across the
 * open Duo's pages (O-Tree), graph | detail panel on the desktop (D-Tree).
 * Polls the tree only while shown.
 *
 * On the closed Duo and phones an agent's detail is pushed over the tree,
 * as the open Duo's right page would show it; the column's back (or the
 * page's own back where there's no column) returns to the tree, and back
 * from the tree goes to the Live activity it was opened from.
 */
export function AgentsView({
  session,
  active,
  onOpenSession,
  onClose,
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
  const { tree, isLoading } = useAgentTree(session.id, active);
  const { selected, detailOpen } = useSnapshot(agentTreeStore);
  const native = useIsNative();
  const mode = useLayoutMode();
  const ref = useRef<HTMLDivElement>(null);
  const pages = useSpreadPages(ref, useSpreadFold());
  const desktop = mode === "desktop" && !native;
  const posture = desktop ? "desktop" : pages ? "open" : "closed";

  const node = selectedNode(tree, selected[session.id]);
  const crumbs = tree && node ? crumbsFor(tree, node.id) : [];

  // A pushed detail belongs to this session and this posture only
  useEffect(() => {
    setDetailOpen(false);
    return () => setDetailOpen(false);
  }, [session.id, posture]);
  const pushed = posture === "closed" && detailOpen && !!node;

  // Back: off the pushed detail to the tree, else out of the view (to the
  // Live activity on the closed Duo, which opened it)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active || posture === "desktop") return;
    return registerNavHandlers({
      goBack: () => {
        if (agentTreeStore.detailOpen) return setDetailOpen(false);
        closeRef.current();
        if (mode === "duo-closed") mobileNavStore.liveOpen = true;
      },
    });
  }, [active, posture, mode]);

  const openTranscript = useCallback(
    (n: TreeNode) => {
      if (hasDetail(n) && n.agentId) {
        // The chat opens the agent's conversation once it shows
        openSubagent(session.id, n.agentId);
        mobileNavActions.requestViewMode("chat", session.id);
      } else if (n.sessionId && n.sessionId !== session.id) {
        onOpenSession(n.sessionId);
      }
    },
    [session.id, onOpenSession]
  );

  // A row in the tree: the session goes back to it, a fork (handoff,
  // worker) opens its own session, an agent shows its detail
  const onTreeSelect = (n: TreeNode) => {
    if (n.kind === "session") return onClose();
    if (opensSession(n)) return onOpenSession(n.sessionId!);
    selectNode(session.id, n.id);
    if (posture === "closed") setDetailOpen(true);
  };

  const detail = node && (
    <AgentDetailPane
      session={session}
      node={node}
      crumbs={crumbs}
      variant={posture === "desktop" ? "panel" : "page"}
      onOpenTranscript={openTranscript}
      onOpenSession={onOpenSession}
      className="h-full"
    />
  );
  const noDetail = (
    <p className="text-muted-foreground px-1 py-6 text-sm">
      {tree && tree.total === 0
        ? "No agents yet"
        : isLoading
          ? ""
          : "Pick an agent"}
    </p>
  );

  if (posture === "desktop")
    return (
      <div
        ref={ref}
        aria-label="Agents"
        className={cn("flex h-full min-h-0 w-full", className)}
      >
        <AgentGraph
          session={session}
          tree={tree}
          isLoading={isLoading}
          selectedId={node?.id ?? null}
          onSelect={(n) => selectNode(session.id, n.id)}
          className="min-w-0 flex-1"
        />
        <aside className="bg-page border-hair flex w-[clamp(340px,25vw,500px)] flex-none flex-col border-l px-[18px] py-5">
          {detail ?? noDetail}
        </aside>
      </div>
    );

  return (
    <div
      ref={ref}
      aria-label="Agents"
      className={cn("flex h-full min-h-0 w-full", className)}
    >
      {pages ? (
        <>
          {/* The tree on the left page, nothing in the fold, the detail right */}
          <div className="flex min-h-0 flex-none" style={{ width: pages.left }}>
            <AgentTree
              session={session}
              tree={tree}
              isLoading={isLoading}
              variant="open"
              selectedId={node?.id ?? null}
              onSelect={onTreeSelect}
              className="w-full pt-5 pr-5 pb-4 pl-6"
            />
          </div>
          <div
            aria-hidden
            className="flex-none"
            style={{ width: pages.gutter }}
          />
          <div
            className="bg-page flex flex-none flex-col pt-5 pr-2 pb-4 pl-4"
            style={{ width: pages.right }}
          >
            {detail ?? noDetail}
          </div>
        </>
      ) : pushed ? (
        <div className="flex min-h-0 w-full flex-col pt-[18px] pr-2 pb-4 pl-5">
          {(mode === "phone" || mode === "tabletop") && (
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="text-primary dark:text-meter -ml-1 flex h-9 w-fit items-center gap-0.5 text-[15px]"
            >
              <ChevronLeft aria-hidden className="h-5 w-5" />
              Agents
            </button>
          )}
          {detail}
        </div>
      ) : (
        <AgentTree
          session={session}
          tree={tree}
          isLoading={isLoading}
          variant="closed"
          selectedId={null}
          onSelect={onTreeSelect}
          className="w-full pt-[18px] pr-2 pb-4 pl-5"
        />
      )}
    </div>
  );
}
