"use client";

import type { Session } from "@/lib/db";
import type { SettleResult, UnsettleResult } from "@/lib/settle-types";

/**
 * Settle and its Undo (M8, N-Settle). Both go through fetchAsUser (the
 * routes are user-only) and refresh the sessions list. `settle` asks first
 * when the session is working or has queued messages, then posts force.
 * Both throw with the route's refusal text.
 */
export interface UseSettle {
  settle: (
    session: Session,
    options?: { force?: boolean }
  ) => Promise<SettleResult>;
  unsettle: (session: Session) => Promise<UnsettleResult>;
}

export function useSettle(): UseSettle {
  const notYet = () => Promise.reject(new Error("Not implemented")); // M8 U3
  return { settle: notYet, unsettle: notYet };
}
