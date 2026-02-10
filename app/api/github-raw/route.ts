import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

/**
 * GET /api/github-raw?url=https://raw.githubusercontent.com/...
 *
 * Fetches raw content from GitHub, using the local `gh` CLI token
 * for authentication (supports private repos).
 */

// Cache the gh auth token for 5 minutes to avoid execSync on every request
let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 5 * 60 * 1000;

function getGhToken(): string | null {
  const now = Date.now();
  if (cachedToken !== null && now - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  try {
    cachedToken = execSync("gh auth token 2>/dev/null", { encoding: "utf-8" }).trim() || null;
  } catch {
    cachedToken = null;
  }
  tokenFetchedAt = now;
  return cachedToken;
}

const ALLOWED_HOSTS = [
  "raw.githubusercontent.com",
  "api.github.com",
  "registry.modelcontextprotocol.io",
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url parameter required" }, { status: 400 });
  }

  // Validate URL is from an allowed domain
  try {
    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return NextResponse.json(
        { error: `Only ${ALLOWED_HOSTS.join(", ")} URLs are allowed` },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const token = getGhToken();

  try {
    const headers: Record<string, string> = {
      "User-Agent": "agent-os",
    };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      // If we got a 401/403 with a cached token, invalidate and retry once
      if ((res.status === 401 || res.status === 403) && token) {
        cachedToken = null;
        tokenFetchedAt = 0;
        const freshToken = getGhToken();
        if (freshToken && freshToken !== token) {
          const retryHeaders: Record<string, string> = {
            "User-Agent": "agent-os",
            "Authorization": `token ${freshToken}`,
          };
          const retryRes = await fetch(url, { headers: retryHeaders });
          if (retryRes.ok) {
            const content = await retryRes.text();
            return NextResponse.json({ content });
          }
        }
      }

      return NextResponse.json(
        { error: `GitHub returned ${res.status}`, content: null },
        { status: res.status }
      );
    }

    const content = await res.text();
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 500 }
    );
  }
}
