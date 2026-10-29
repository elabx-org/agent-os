"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import { registerNavHandlers } from "@/lib/nav-actions";
import { headerShowsActivity, headerVariant } from "@/lib/session-views";
import { mobileNavStore } from "@/stores/mobileNav";
import { duoPreviewStore, loadDuoPreview } from "@/stores/duoPreview";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useIsNative } from "@/hooks/useIsNative";
import { useAgentTree } from "@/hooks/useAgentTree";
import { interruptSession } from "@/components/DeckActions";

/**
 * What the pane's session chrome needs from the pane: the column learns
 * whether the focused session works (its Stop, N-Queue) and how many agents
 * it started (the Agents item, M13), and Stop interrupts that session; and
 * which header the pane shows (SessionTitleBar decides the same way), so the
 * strip stays away from one that says it already
 */
export function usePaneChrome({
  session,
  isFocused,
  paneCount,
}: {
  session: Session | null | undefined;
  isFocused: boolean;
  paneCount: number;
}) {
  const { statuses, railActive } = useSnapshot(mobileNavStore);
  const { on: titleInPage } = useSnapshot(duoPreviewStore);
  const layout = useLayoutMode();
  const native = useIsNative();
  // Every layout reads the device's choice, not only the phone's
  useEffect(loadDuoPreview, []);
  const sessionId = session?.id;
  const working = !!sessionId && statuses[sessionId]?.status === "running";

  useEffect(() => {
    if (!isFocused) return;
    mobileNavStore.working = working;
    return () => {
      mobileNavStore.working = false;
    };
  }, [isFocused, working]);

  // The focused session's agents: the column's Agents item and the
  // desktop header's Agents segment and "7 agents" (one shared tree poll)
  const { tree } = useAgentTree(sessionId, isFocused);
  const agentCount =
    tree && tree.root.id === `session:${sessionId}` ? tree.total : 0;
  useEffect(() => {
    if (!isFocused) return;
    mobileNavStore.agentCount = agentCount;
    return () => {
      mobileNavStore.agentCount = 0;
    };
  }, [isFocused, agentCount]);

  // While a session pane is focused, Stop is its interrupt (Esc)
  useEffect(() => {
    if (!isFocused || !sessionId) return;
    return registerNavHandlers({
      stopSession: () => void interruptSession(sessionId),
    });
  }, [isFocused, sessionId]);

  const variant = headerVariant({
    hasSession: !!session,
    layout,
    native,
    paneCount,
    titleInPage,
    columnShown: railActive,
  });
  return { variant, headerHasActivity: headerShowsActivity(variant) };
}
