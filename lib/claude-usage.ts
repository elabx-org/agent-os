/**
 * Claude's plan usage (Anthropic's OAuth usage endpoint), moved out of
 * app/api/claude-usage/route.ts so the route and the Limited detector share
 * one cache: on globalThis (server.ts and Next's bundle load separate
 * copies), at least 60s between real requests, and one 429 backoff. The
 * last good answer is kept in $AGENT_OS_HOME/usage-cache.json, so a restart
 * or a 429 still has figures to show.
 */

import fs from "fs";
import os from "os";
import path from "path";

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

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
/** At least this long between real requests, whatever they answered */
const MIN_INTERVAL = 60_000;
// Anthropic limits this endpoint per account, and Claude Code's own /usage
// shares the limit: after a 429, wait this long (or Retry-After) before asking again
const BACKOFF = 5 * 60_000;
// An hour old is still useful; older could show a window that has reset
const STALE_MAX = 60 * 60_000;

const TIER_MAP: Record<string, string> = {
  default_claude_pro: "Pro",
  default_claude_max_5x: "Max 5x",
  default_claude_max_20x: "Max 20x",
};

export interface UsageClientOptions {
  fetch?: typeof fetch;
  credentialsPath?: string;
  cacheFile?: string;
  now?: () => number;
}

interface Credentials {
  accessToken: string;
  refreshToken: string;
  rateLimitTier: string;
}

interface Cached {
  data: UsageResponse;
  timestamp: number;
}

/** One cache, backoff and request gate (the shared one is on globalThis) */
export function createUsageClient(options: UsageClientOptions = {}) {
  const doFetch = options.fetch ?? ((...args) => fetch(...args));
  const now = options.now ?? Date.now;
  const credentialsPath =
    options.credentialsPath ??
    path.join(process.env.HOME || "/config", ".claude", ".credentials.json");
  const cacheFile =
    options.cacheFile ??
    path.join(
      process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os"),
      "usage-cache.json"
    );

  let cache: Cached | null = readCache();
  let backoffUntil = 0;
  let lastAttempt = 0;
  /** What the last real request failed with, served until the next one */
  let lastError: { error: string; status: number } | null = null;
  let inflight: Promise<UsageResult> | null = null;

  function readCache(): Cached | null {
    try {
      const stored = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      return stored?.data && typeof stored.timestamp === "number"
        ? stored
        : null;
    } catch {
      return null;
    }
  }

  function writeCache() {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      // non-fatal: the in-memory copy still serves
    }
  }

  /** The last good figures, marked stale, or the error if there are none */
  function lastGood(error: string, status: number): UsageResult {
    if (cache && now() - cache.timestamp < STALE_MAX)
      return { status: 200, data: { ...cache.data, stale: true } };
    return { status, error };
  }

  function readCredentials(): Credentials | null {
    try {
      const data = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
      const oauth = data?.claudeAiOauth;
      if (!oauth?.accessToken) return null;
      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken || "",
        rateLimitTier: oauth.rateLimitTier || "",
      };
    } catch {
      return null;
    }
  }

  async function refreshToken(refreshTokenValue: string) {
    try {
      const res = await doFetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshTokenValue,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newToken = data.access_token;
      if (!newToken) return null;

      // Update credentials file with new token
      try {
        const creds = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
        if (creds.claudeAiOauth) {
          creds.claudeAiOauth.accessToken = newToken;
          if (data.refresh_token) {
            creds.claudeAiOauth.refreshToken = data.refresh_token;
          }
          fs.writeFileSync(credentialsPath, JSON.stringify(creds, null, 2));
        }
      } catch {
        // non-fatal: the token still works for this request
      }
      return newToken as string;
    } catch {
      return null;
    }
  }

  function fetchUsage(token: string) {
    return doFetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
    });
  }

  function failed(error: string, status: number): UsageResult {
    lastError = { error, status };
    return lastGood(error, status);
  }

  async function request(creds: Credentials): Promise<UsageResult> {
    lastAttempt = now();
    lastError = null;
    try {
      let res = await fetchUsage(creds.accessToken);

      // Token refresh on 401
      if (res.status === 401 && creds.refreshToken) {
        const newToken = await refreshToken(creds.refreshToken);
        if (newToken) res = await fetchUsage(newToken);
      }

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("retry-after")) * 1000;
          backoffUntil = now() + (retryAfter > 0 ? retryAfter : BACKOFF);
        }
        return failed(`Anthropic API error: ${res.status}`, res.status);
      }

      const raw = await res.json();
      const plan =
        TIER_MAP[creds.rateLimitTier] || creds.rateLimitTier || "Unknown";
      const data: UsageResponse = {
        five_hour: raw.five_hour || { utilization: null, resets_at: null },
        seven_day: raw.seven_day || { utilization: null, resets_at: null },
        seven_day_sonnet: raw.seven_day_sonnet || null,
        seven_day_opus: raw.seven_day_opus || null,
        extra_usage: raw.extra_usage || {
          is_enabled: false,
          utilization: null,
          used_credits: null,
          monthly_limit: null,
        },
        plan,
      };
      cache = { data, timestamp: now() };
      writeCache();
      return { status: 200, data };
    } catch {
      return failed("Usage request failed", 502);
    }
  }

  return {
    /** The usage, from the cache when fresh; never more than once a minute */
    async get(): Promise<UsageResult> {
      if (cache && now() - cache.timestamp < MIN_INTERVAL) {
        return { status: 200, data: cache.data };
      }
      if (now() < backoffUntil) {
        return lastGood("Anthropic API error: 429", 429);
      }
      if (inflight) return inflight;
      if (now() - lastAttempt < MIN_INTERVAL) {
        // Asked under a minute ago and it failed: the same answer again
        if (lastError) return lastGood(lastError.error, lastError.status);
        if (cache) return { status: 200, data: cache.data };
      }

      const creds = readCredentials();
      if (!creds) {
        return { status: 404, error: "No Claude credentials found" };
      }
      inflight = request(creds).finally(() => {
        inflight = null;
      });
      return inflight;
    },

    /** The last good figures without asking (null when none) */
    cached(): UsageResponse | null {
      return cache ? cache.data : null;
    },
  };
}

export type UsageClient = ReturnType<typeof createUsageClient>;

// On globalThis: server.ts (the detector) and the route (Next's bundle) load
// separate copies of this module
const shared = globalThis as unknown as { __agentosUsage?: UsageClient };

function client(): UsageClient {
  shared.__agentosUsage ??= createUsageClient();
  return shared.__agentosUsage;
}

/** The usage, from the cache when fresh; never more than once a minute */
export async function getClaudeUsage(): Promise<UsageResult> {
  return client().get();
}

/** The last good figures without asking (null when none), for the detector */
export function cachedClaudeUsage(): UsageResponse | null {
  return client().cached();
}
