import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { searchCode, formatSearchResults } from "@/lib/code-search";

const execFileAsync = promisify(execFile);

/** Outside a git repo (a session in ~, say) search only near the top */
const NON_GIT_MAX_DEPTH = 3;

async function insideGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("query");
    const path = searchParams.get("path");
    const maxResults = parseInt(searchParams.get("maxResults") || "100");
    const contextLines = parseInt(searchParams.get("contextLines") || "2");

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter is required" },
        { status: 400 }
      );
    }

    if (!path) {
      return NextResponse.json(
        { error: "Path parameter is required" },
        { status: 400 }
      );
    }

    const expandedPath = path.replace(/^~/, process.env.HOME || "");

    const rawMatches = await searchCode(expandedPath, query, {
      maxResults,
      contextLines,
      maxDepth: (await insideGitRepo(expandedPath))
        ? undefined
        : NON_GIT_MAX_DEPTH,
      signal: request.signal,
    });

    const results = formatSearchResults(rawMatches);

    return NextResponse.json({
      results,
      query,
      path: expandedPath,
      count: results.length,
    });
  } catch (error) {
    console.error("Code search error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to search code";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
