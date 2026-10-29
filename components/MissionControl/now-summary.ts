import { timeAgo } from "@/lib/agent-state";

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

/** A row's age without "ago": "2m", "3h", "now" */
export function shortAge(value: number | string): string {
  const age = timeAgo(value, { dateAfterDays: Infinity });
  return age === "just now" ? "now" : age.replace(/ ago$/, "");
}
