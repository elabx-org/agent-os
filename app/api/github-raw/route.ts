import { NextRequest, NextResponse } from "next/server";
import { ghFetch } from "@/lib/github";

/**
 * GET /api/github-raw?url=https://raw.githubusercontent.com/...
 *
 * Fetches raw content from GitHub, using the local `gh` CLI token
 * for authentication (supports private repos).
 */

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

  try {
    const res = await ghFetch(url);

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
