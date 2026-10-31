"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import { registerNavHandlers } from "@/lib/nav-actions";
import { headerShowsActivity, headerVariant } from "@/lib/session-views";
import { mobileNavStore } from "@/stores/mobileNav";
import { duoPreviewStore, loadDuoPreview } from "@/stores/duoPreview";
import { moveSheetStore } from "@/stores/moveSheet";
import { useCanOfferMove } from "@/hooks/useWorktreeMove";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useIsNative } from "@/hooks/useIsNative";
import { interruptSession } from "@/components/DeckActions";
import { useSettleActions } from "@/components/Session/settle-action";
import { canSettle } from "@/lib/settle-views";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { sessionActionsStore } from "@/stores/sessionActions";

/**
 * What the pane's session chrome needs from the pane: the column learns
 * whether the focused session works (its Stop, N-Queue) and Stop interrupts
 * that session; and which header the pane shows (SessionTitleBar decides
 * the same way), so the strip stays away from one that says it already
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
  const movable = useCanOfferMove(session);

  useEffect(() => {
    if (!isFocused) return;
    mobileNavStore.working = working;
    return () => {
      mobileNavStore.working = false;
    };
  }, [isFocused, working]);

  // While a session pane is focused, Stop is its interrupt (Esc)
  useEffect(() => {
    if (!isFocused || !sessionId) return;
    return registerNavHandlers({
      stopSession: () => void interruptSession(sessionId),
    });
  }, [isFocused, sessionId]);

  // The column's More (and the iOS app's) offers the header ⋯'s Scripts,
  // Settle and Copy session ID: that ⋯ is hidden on the closed Duo's page
  // header, beside the pills and in Changes and Files
  const { settle } = useSettleActions();
  const { copy } = useCopyToClipboard();
  const titles = useListTitles(session ? [session] : []);
  const latest = useRef({ session, titles, settle, copy });
  latest.current = { session, titles, settle, copy };
  const scripts =
    !!session?.project_id && session.project_id !== "uncategorized";
  const settleable = !!session && canSettle(session);
  useEffect(() => {
    if (!isFocused || !sessionId) return;
    Object.assign(sessionActionsStore, {
      sessionId,
      scripts,
      settle: settleable,
    });
    const unregister = registerNavHandlers({
      settleSession: () => {
        const { session, titles, settle } = latest.current;
        if (session) void settle(session, displayTitle(session, titles).title);
      },
      copySessionId: async () => {
        if (await latest.current.copy(sessionId))
          toast.success("Session ID copied");
        else toast.error("Couldn't copy the session ID");
      },
    });
    return () => {
      unregister();
      if (sessionActionsStore.sessionId === sessionId)
        Object.assign(sessionActionsStore, {
          sessionId: null,
          scripts: false,
          settle: false,
        });
    };
  }, [isFocused, sessionId, scripts, settleable]);

  // The column's ⋯ offers "Move to a worktree" for the focused session
  useEffect(() => {
    if (!isFocused || !movable || !sessionId) return;
    moveSheetStore.offer = sessionId;
    return () => {
      if (moveSheetStore.offer === sessionId) moveSheetStore.offer = null;
    };
  }, [isFocused, movable, sessionId]);

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
