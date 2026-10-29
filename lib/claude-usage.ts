/**
 * Claude's plan usage (Anthropic's OAuth usage endpoint), moved out of
 * app/api/claude-usage/route.ts so the route and the Limited detector share
 * one cache: on globalThis (server.ts and Next's bundle load separate
 * copies), at least 60s old before asking again, and one 429 backoff. U6.1
 * implements and turns the route into a wrapper.
 */

export interface UsageBlock {
  /** Percent used */
  utilization: number | null;
  /** ISO time */
  resets_at: string | null;
}

export interface ExtraUsage {
  is_enabled: boolean;
  utilization: number | null;
  used_credits: number | null;
  monthly_limit: number | null;
}

export interface UsageResponse {
  five_hour: UsageBlock;
  seven_day: UsageBlock;
  seven_day_sonnet: UsageBlock | null;
  seven_day_opus: UsageBlock | null;
  extra_usage: ExtraUsage;
  plan: string;
  /** The last good figures, served during a 429 backoff or an error */
  stale?: true;
}

/** What GET /api/claude-usage answers, with its HTTP status */
export type UsageResult =
  | { status: 200; data: UsageResponse }
  | { status: number; error: string };

/** The usage, from the cache when fresh; never more than once a minute */
export async function getClaudeUsage(): Promise<UsageResult> {
  throw new Error("getClaudeUsage: not implemented (M6 U6.1)");
}

/** The last good figures without asking (null when none), for the detector */
export function cachedClaudeUsage(): UsageResponse | null {
  return null;
}
