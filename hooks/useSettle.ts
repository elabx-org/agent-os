"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { confirmAction } from "@/components/ui/confirm";
import { settleErrorText } from "@/components/MissionControl/settle-model";
import { sessionKeys } from "@/data/sessions/keys";
import { fetchAsUser } from "@/lib/client/user-fetch";
import type { Session } from "@/lib/db";
import type {
  SettleError,
  SettleRequest,
  SettleResult,
  UnsettleResult,
} from "@/lib/settle-types";
import { SettleCancelled } from "@/lib/undo";

/**
 * Settle and its Undo (M8, N-Settle). Both go through fetchAsUser (the
 * routes are user-only) and refresh the sessions list. `settle` asks first
 * when the session is working or has queued messages, then posts force.
 * Both throw with the route's refusal text (SettleCancelled when the user
 * declined to settle a working session).
 */
export interface UseSettle {
  settle: (
    session: Session,
    options?: { force?: boolean }
  ) => Promise<SettleResult>;
  unsettle: (session: Session) => Promise<UnsettleResult>;
}

/** The route refused: its words, and the reason when it gave one */
class SettleRefusal extends Error {
  constructor(readonly body: Partial<SettleError>) {
    super(settleErrorText(body));
    this.name = "SettleRefusal";
  }
}

async function call<T>(
  session: Session,
  method: "POST" | "DELETE",
  body?: SettleRequest
): Promise<T> {
  const res = await fetchAsUser(`/api/sessions/${session.id}/settle`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    // A settle committed as the page goes away still goes through
    keepalive: true,
  });
  const data = (await res.json().catch(() => ({}))) as T & Partial<SettleError>;
  if (!res.ok) throw new SettleRefusal(data);
  return data;
}

/** Asks before settling a working session; the tmux window closes */
export function confirmSettleBusy(): Promise<boolean> {
  return confirmAction({
    title: "It is still working. Settle anyway?",
    message: "Its tmux window closes. The chat stays readable.",
    confirmLabel: "Settle",
  });
}

export function useSettle(): UseSettle {
  const queryClient = useQueryClient();
  return useMemo(() => {
    // Awaited, so a row shown settled meanwhile doesn't flick back
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });

    const settle: UseSettle["settle"] = async (session, options) => {
      try {
        const result = await call<SettleResult>(session, "POST", {
          force: options?.force || undefined,
        });
        await refresh();
        return result;
      } catch (e) {
        if (
          !(e instanceof SettleRefusal) ||
          e.body.reason !== "busy" ||
          options?.force
        )
          throw e;
        if (!(await confirmSettleBusy())) throw new SettleCancelled();
        return settle(session, { force: true });
      }
    };

    const unsettle: UseSettle["unsettle"] = async (session) => {
      const result = await call<UnsettleResult>(session, "DELETE");
      await refresh();
      return result;
    };

    return { settle, unsettle };
  }, [queryClient]);
}
