import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

/**
 * GET /api/github-raw?url=https://raw.githubusercontent.com/...
 *
 * Fetches raw content from GitHub, using the local `gh` CLI token
 * for authentication (supports private repos).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url parameter required" }, { status: 400 });
  }

  // Validate URL is a GitHub raw content URL
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "raw.githubusercontent.com" &&
      parsed.hostname !== "api.github.com"
    ) {
      return NextResponse.json(
        { error: "Only raw.githubusercontent.com and api.github.com URLs are allowed" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Try to get gh auth token for private repo access
  let token: string | null = null;
  try {
    token = execSync("gh auth token 2>/dev/null", { encoding: "utf-8" }).trim();
  } catch {
    // gh CLI not available or not authenticated — proceed without token
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "agent-os",
    };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
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
