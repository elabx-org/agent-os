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
  const parts: string[] = [];
  if (counts.needs > 0)
    parts.push(`${counts.needs} ${counts.needs === 1 ? "needs" : "need"} you`);
  if (counts.limited > 0) parts.push(`${counts.limited} limited`);
  if (counts.working > 0) parts.push(`${counts.working} working`);
  if (counts.settledToday > 0)
    parts.push(`${counts.settledToday} settled today`);
  return parts.length ? parts.join(" · ") : "All quiet";
}

export { shortAge } from "@/lib/agent-state";
