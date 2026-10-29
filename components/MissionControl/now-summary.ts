import type { Session } from "@/lib/db/types";
import { isPaused } from "@/lib/handoff-types";

/** The counts the Now subline is made of */
export interface NowCounts {
  needs: number;
  working: number;
  limited: number;
  settledToday: number;
}

/**
 * "2 need you · 2 working[ · N limited][ · N settled today]": zero counts
 * left out, "All quiet" when everything is zero
 */
export function nowSubline(counts: NowCounts): string {
  const parts: string[] = [];
  if (counts.needs > 0)
    parts.push(`${counts.needs} ${counts.needs === 1 ? "needs" : "need"} you`);
  if (counts.working > 0) parts.push(`${counts.working} working`);
  if (counts.limited > 0) parts.push(`${counts.limited} limited`);
  if (counts.settledToday > 0)
    parts.push(`${counts.settledToday} settled today`);
  return parts.length ? parts.join(" · ") : "All quiet";
}

/**
 * Quiet sessions outside any project: live ones first, then the paused
 * (handed-off) ones, each most recent first
 */
export function sortQuietSessions<
  S extends Pick<Session, "updated_at" | "paused_at">,
>(sessions: readonly S[]): S[] {
  return [...sessions].sort(
    (a, b) =>
      Number(isPaused(a)) - Number(isPaused(b)) ||
      b.updated_at.localeCompare(a.updated_at)
  );
}

export { shortAge } from "@/lib/agent-state";
