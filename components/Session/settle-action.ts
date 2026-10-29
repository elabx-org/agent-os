"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { agentName } from "@/components/a/Avatar";
import { confirmAction } from "@/components/ui/confirm";
import { sessionKeys } from "@/data/sessions/keys";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type { Session } from "@/lib/db";
import type {
  SettleError,
  SettleResult,
  UnsettleResult,
} from "@/lib/settle-types";
import {
  isBusyRefusal,
  notRelaunchedText,
  settledToast,
} from "@/lib/settle-views";

/** The page attaches a session sent this way (lib/restart-session.ts) */
export function showSession(session: Session) {
  window.dispatchEvent(
    new CustomEvent("agentos-session-restarted", { detail: { session } })
  );
}

async function call<T>(
  sessionId: string,
  init: RequestInit
): Promise<
  { ok: true; data: T } | { ok: false; status: number; body: SettleError }
> {
  const res = await fetchAsUser(`/api/sessions/${sessionId}/settle`, init);
  const body = await res.json().catch(() => null);
  if (res.ok && body) return { ok: true, data: body as T };
  return {
    ok: false,
    status: res.status,
    body: (body as SettleError) ?? { error: "Something went wrong" },
  };
}

/**
 * Settle from a session's ⋯ (asks first while it works, toasts with Undo)
 * and its Undo / Resume (DELETE: clears settled_at, relaunches the agent).
 * Both refresh the sessions list; refusals show as a toast.
 */
export function useSettleActions() {
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: sessionKeys.list() }),
    [queryClient]
  );

  /** Null when refused (already toasted) */
  const unsettle = useCallback(
    async (session: Session): Promise<UnsettleResult | null> => {
      const r = await call<UnsettleResult>(session.id, { method: "DELETE" });
      refresh();
      if (!r.ok) {
        toast.error(refusalText(r.body));
        return null;
      }
      if (!r.data.relaunched)
        toast(notRelaunchedText(agentName(session.agent_type)));
      showSession(r.data.session);
      return r.data;
    },
    [refresh]
  );

  /** Null when refused or the user kept it going */
  const settle = useCallback(
    async (session: Session, title: string): Promise<SettleResult | null> => {
      const post = (force: boolean) =>
        call<SettleResult>(session.id, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(force ? { force: true } : {}),
        });
      let r = await post(false);
      if (!r.ok && isBusyRefusal(r.status, r.body)) {
        const ok = await confirmAction({
          title: "Settle while it works?",
          message: `${agentName(session.agent_type)} is working or has messages waiting. Settling stops it and closes its terminal; the chat stays readable.`,
          confirmLabel: "Settle",
          destructive: true,
        });
        if (!ok) return null;
        r = await post(true);
      }
      refresh();
      if (!r.ok) {
        toast.error(refusalText(r.body));
        return null;
      }
      const settled = r.data.session;
      const { message, description } = settledToast(title, settled);
      toast(message, {
        description,
        action: { label: "Undo", onClick: () => void unsettle(settled) },
      });
      return r.data;
    },
    [refresh, unsettle]
  );

  return { settle, unsettle };
}
