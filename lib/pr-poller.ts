/**
 * The PR poller (M8, flag prPoller): every PR_POLL_MS one async
 * `gh pr list --state all` per repo, matched to its sessions' branches,
 * written to the pr_* columns; a newly merged PR hands its session to
 * auto-settle. Started from lib/tickers.ts.
 */

/** What one pass did */
export interface PrPollReport {
  repos: number;
  updated: number;
  merged: string[];
}

export async function pollPrsOnce(): Promise<PrPollReport> {
  return { repos: 0, updated: 0, merged: [] }; // M8 U2
}

export function startPrPoller(): void {
  // M8 U2
}
