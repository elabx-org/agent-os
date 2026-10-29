/**
 * The usage-limit card's words and which form it takes (N-Limited). Pure:
 * no React, no fetch, so the unit tests read it directly.
 */

import { refusalText } from "@/lib/client/user-fetch";
import { formatReset } from "@/lib/usage-reset";
import {
  limitKindLabel,
  limitStateOf,
  type LimitState,
} from "@/lib/limits/types";
import type { Session } from "@/lib/db/types";

type LimitColumns = Pick<
  Session,
  | "limited_at"
  | "limited_until"
  | "limit_kind"
  | "resume_policy"
  | "resume_text"
>;

/**
 * card: the three choices (no policy yet); scheduled: "Will resume at …"
 * with Cancel (at_reset, until the next busy edge clears it, so it stays
 * past the reset while the resume waits for the session to be ready);
 * snoozed: a quiet row until the reset. Null: not limited
 */
export type LimitView = "card" | "scheduled" | "snoozed";

export function limitView(
  session: Partial<LimitColumns>,
  now: number = Date.now()
): LimitView | null {
  const state = limitStateOf(session, now);
  if (state.policy === "at_reset" && state.limitedAt !== null)
    return "scheduled";
  if (!state.limited) return null;
  return state.policy === "snooze" ? "snoozed" : "card";
}

/** Now's Limited section: every session with a view, oldest limit first */
export function limitedSessions<T extends Partial<LimitColumns>>(
  sessions: T[],
  now: number = Date.now()
): T[] {
  return sessions
    .filter((s) => limitView(s, now) !== null)
    .sort((a, b) => (a.limited_at ?? 0) - (b.limited_at ?? 0));
}

/** "3:40 pm" (or the day, past a day away); empty when unknown */
export function resetTime(
  until: number | null,
  now: number = Date.now()
): string {
  if (until === null || !Number.isFinite(until)) return "";
  return formatReset(new Date(until).toISOString(), { now: new Date(now) });
}

/** The card's right edge: "in 1h 12m", "in 5m", "in 2d"; empty if unknown
    or already past */
export function resetIn(
  until: number | null,
  now: number = Date.now()
): string {
  if (until === null || !Number.isFinite(until)) return "";
  const ms = until - now;
  if (ms <= 0) return "";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return mins % 60 ? `in ${hours}h ${mins % 60}m` : `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

/** "Claude hit the session limit · resets 3:40 pm" */
export function limitLine(
  state: LimitState,
  agent: string,
  now: number = Date.now()
): string {
  const hit = `${agent} hit the ${limitKindLabel(state.kind)}`;
  const at = resetTime(state.limitedUntil, now);
  return at ? `${hit} · resets ${at}` : hit;
}

/** The scheduled row: "Will resume at 3:40 pm", or when it can */
export function scheduledLine(
  state: LimitState,
  now: number = Date.now()
): string {
  if (state.limitedUntil !== null && state.limitedUntil <= now)
    return "Resuming when it's ready";
  const at = resetTime(state.limitedUntil, now);
  return at ? `Will resume at ${at}` : "Will resume at the reset";
}

/** The snoozed row: "Snoozed · resets 3:40 pm" */
export function snoozedLine(
  state: LimitState,
  now: number = Date.now()
): string {
  const at = resetTime(state.limitedUntil, now);
  return at ? `Snoozed · resets ${at}` : "Snoozed";
}

/** A session row with a resume result's state written back, so the card
    changes before the sessions list is refetched */
export function withLimitState<T extends Partial<LimitColumns>>(
  session: T,
  state: LimitState
): T {
  return {
    ...session,
    limited_at: state.limitedAt,
    limited_until: state.limitedUntil,
    limit_kind: state.limitedAt === null ? null : state.kind,
    resume_policy: state.policy,
    resume_text: state.resumeText,
  };
}

/**
 * The next time the limit views change on their own: the earliest reset
 * still ahead, or null. The clock hook wakes up then
 */
export function nextLimitChange(
  untils: (number | null | undefined)[],
  now: number = Date.now()
): number | null {
  let next: number | null = null;
  for (const until of untils)
    if (until != null && until > now && (next === null || until < next))
      next = until;
  return next;
}

/** A resume route's refusal in words */
export function resumeErrorText(
  status: number,
  body: { error?: string; reason?: string } | null
): string {
  if (status === 501) return "Resuming after a limit isn't available yet";
  if (status === 404) return "That session has gone";
  if (body?.error) return refusalText(body);
  return `Couldn't change the resume (${status})`;
}
