import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CREDENTIALS_PATH = path.join(
  process.env.HOME || "/config",
  ".claude",
  ".credentials.json"
);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CACHE_TTL = 30_000; // 30 seconds

interface UsageBlock {
  utilization: number | null;
  resets_at: string | null;
}

interface ExtraUsage {
  is_enabled: boolean;
  utilization: number | null;
  used_credits: number | null;
  monthly_limit: number | null;
}

interface UsageResponse {
  five_hour: UsageBlock;
  seven_day: UsageBlock;
  seven_day_sonnet: UsageBlock | null;
  seven_day_opus: UsageBlock | null;
  extra_usage: ExtraUsage;
  plan: string;
}

// Module-level cache
let cache: { data: UsageResponse; timestamp: number } | null = null;

const TIER_MAP: Record<string, string> = {
  default_claude_pro: "Pro",
  default_claude_max_5x: "Max 5x",
  default_claude_max_20x: "Max 20x",
};

function readCredentials(): {
  accessToken: string;
  refreshToken: string;
  rateLimitTier: string;
} | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw);
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

async function refreshToken(
  refreshTokenValue: string
): Promise<string | null> {
  try {
    const res = await fetch(TOKEN_URL, {
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
      const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
      const creds = JSON.parse(raw);
      if (creds.claudeAiOauth) {
        creds.claudeAiOauth.accessToken = newToken;
        if (data.refresh_token) {
          creds.claudeAiOauth.refreshToken = data.refresh_token;
        }
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
      }
    } catch {
      // non-fatal — token still works for this request
    }

    return newToken;
  } catch {
    return null;
  }
}

async function fetchUsage(token: string): Promise<Response> {
  return fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
  });
}

export async function GET() {
  // Return cached data if fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  const creds = readCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "No Claude credentials found" },
      { status: 404 }
    );
  }

  let token = creds.accessToken;
  let res = await fetchUsage(token);

  // Token refresh on 401
  if (res.status === 401 && creds.refreshToken) {
    const newToken = await refreshToken(creds.refreshToken);
    if (newToken) {
      token = newToken;
      res = await fetchUsage(token);
    }
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Anthropic API error: ${res.status}` },
      { status: res.status }
    );
  }

  const raw = await res.json();
  const plan = TIER_MAP[creds.rateLimitTier] || creds.rateLimitTier || "Unknown";

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

  cache = { data, timestamp: Date.now() };
  return NextResponse.json(data);
}
