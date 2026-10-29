import type { Session } from "@/lib/db/types";
import { isPaused } from "@/lib/handoff-types";
import { isSettled } from "@/lib/settle-types";

/** The counts the Now subline is made of */
export interface NowCounts {
  needs: number;
  working: number;
  limited: number;
  settledToday: number;
}

/**
 * "2 need you[ · N limited] · 2 working[ · N settled today]": zero counts
 * left out, "All quiet" when everything is zero. Limited comes before
 * working (N-Limited): it waits on you too, and a narrow line cuts the end
 */
export function nowSubline(counts: NowCounts): string {
  const parts = nowSublineParts(counts);
  return parts.length ? parts.join(" · ") : "All quiet";
}

/**
 * Quiet sessions outside any project: live ones first, then the paused
 * (handed-off) ones, then the settled ones (M8), each most recent first
 */
export function sortQuietSessions<
  S extends Pick<Session, "updated_at" | "paused_at"> &
    Partial<Pick<Session, "settled_at">>,
>(sessions: readonly S[]): S[] {
  const rank = (s: S) => (isPaused(s) ? 1 : isSettled(s) ? 2 : 0);
  return [...sessions].sort(
    (a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at)
  );
}

/** The subline's counts, most pressing first; empty when all are zero */
export function nowSublineParts(counts: NowCounts): string[] {
  const parts: string[] = [];
  if (counts.needs > 0)
    parts.push(`${counts.needs} ${counts.needs === 1 ? "needs" : "need"} you`);
  if (counts.limited > 0) parts.push(`${counts.limited} limited`);
  if (counts.working > 0) parts.push(`${counts.working} working`);
  if (counts.settledToday > 0)
    parts.push(`${counts.settledToday} settled today`);
  return parts;
}

export { shortAge } from "@/lib/agent-state";
