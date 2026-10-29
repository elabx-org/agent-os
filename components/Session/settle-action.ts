"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { agentName } from "@/components/a/Avatar";
import { useSettle } from "@/hooks/useSettle";
import type { Session } from "@/lib/db";
import type { SettleResult, UnsettleResult } from "@/lib/settle-types";
import { notRelaunchedText, settledToast } from "@/lib/settle-views";
import { SettleCancelled } from "@/lib/undo";

/** The page attaches a session sent this way (lib/restart-session.ts) */
export function showSession(session: Session) {
  window.dispatchEvent(
    new CustomEvent("agentos-session-restarted", { detail: { session } })
  );
}

/**
 * Settle from a session's ⋯ (asks first while it works, toasts with Undo)
 * and its Undo / Resume (DELETE: clears settled_at, relaunches the agent).
 * The calls are hooks/useSettle's (shared with Now); refusals show as a toast.
 */
export function useSettleActions() {
  const hook = useSettle();

  /** Null when refused (already toasted) */
  const unsettle = useCallback(
    async (session: Session): Promise<UnsettleResult | null> => {
      try {
        const result = await hook.unsettle(session);
        if (!result.relaunched)
          toast(notRelaunchedText(agentName(session.agent_type)));
        showSession(result.session);
        return result;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [hook]
  );

  /** Null when refused or the user kept it going */
  const settle = useCallback(
    async (session: Session, title: string): Promise<SettleResult | null> => {
      let result: SettleResult;
      try {
        // Asks first while it works or has messages waiting, then forces
        result = await hook.settle(session);
      } catch (e) {
        if (!(e instanceof SettleCancelled))
          toast.error(e instanceof Error ? e.message : String(e));
        return null;
      }
      const settled = result.session;
      const { message, description } = settledToast(title, settled);
      toast(message, {
        description,
        action: { label: "Undo", onClick: () => void unsettle(settled) },
      });
      return result;
    },
    [hook, unsettle]
  );

  return { settle, unsettle };
}
