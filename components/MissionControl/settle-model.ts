/**
 * The Now page's settle logic (N-Settle), pure so the tests share it: what
 * is settled today, the Done today items made from them, swiped sessions
 * shown as settled while their Undo window runs, which auto-settles get a
 * toast, and a refused settle in words.
 */

import { refusalText } from "@/lib/client/user-fetch";
import type { Session } from "@/lib/db/types";
import { isSettled, settledToday, type SettleError } from "@/lib/settle-types";

/** A just-settled session gets its toast for this long after settling */
export const AUTO_SETTLE_TOAST_MS = 2 * 60 * 1000;

/**
 * Swiped sessions (id → ms swiped) read as settled by hand at once, before
 * the settle is sent; the rest are as the server has them
 */
export function withPendingSettles<S extends Session>(
  sessions: S[],
  pending: Readonly<Record<string, number>>
): S[] {
  if (!Object.keys(pending).length) return sessions;
  return sessions.map((s) =>
    pending[s.id] && !isSettled(s)
      ? { ...s, settled_at: pending[s.id], settled_reason: "manual" }
      : s
  );
}

/** Sessions settled on now's day, not workers, newest first */
export function settledTodayList<
  S extends Pick<Session, "settled_at" | "conductor_session_id">,
>(sessions: readonly S[], now: number): S[] {
  return sessions
    .filter((s) => !s.conductor_session_id && settledToday(s, now))
    .sort((a, b) => (b.settled_at ?? 0) - (a.settled_at ?? 0));
}

/** One "Done today" row: a settled session, its merged PR's number */
export interface DoneItem {
  sessionId: string;
  title: string;
  prNumber?: number;
  /** epoch ms */
  at: number;
}

export function doneTodayItems<
  S extends Pick<Session, "id" | "settled_at" | "pr_number" | "pr_status">,
>(settled: readonly S[], titleOf: (session: S) => string): DoneItem[] {
  return settled.map((s) => ({
    sessionId: s.id,
    title: titleOf(s),
    ...(s.pr_status === "merged" && s.pr_number != null
      ? { prNumber: s.pr_number }
      : {}),
    at: s.settled_at ?? 0,
  }));
}

/**
 * The sessions auto-settle took in the last two minutes that haven't had a
 * toast yet (`shown` holds those that have)
 */
export function freshAutoSettles<
  S extends Pick<Session, "id" | "settled_at" | "settled_reason">,
>(sessions: readonly S[], shown: ReadonlySet<string>, now: number): S[] {
  return sessions.filter(
    (s) =>
      s.settled_reason === "pr_merged" &&
      !!s.settled_at &&
      now - s.settled_at < AUTO_SETTLE_TOAST_MS &&
      s.settled_at <= now + 60_000 &&
      !shown.has(s.id)
  );
}

/** The toast's second line: the merged PR, else what settling did */
export function settleCaption(
  session: Pick<Session, "pr_number" | "pr_status">
): string {
  return session.pr_status === "merged" && session.pr_number != null
    ? `PR #${session.pr_number} merged`
    : "The chat stays readable";
}

/** A refused settle or undo in words */
export function settleErrorText(body: {
  error?: string;
  reason?: SettleError["reason"] | string;
}): string {
  switch (body.reason) {
    case "busy":
      return "It is still working";
    case "already_settled":
      return "It's already settled";
    case "not_settled":
      return "It isn't settled";
    case "paused":
      return "It was handed off: resume it instead";
  }
  return refusalText(body);
}
