import { NextRequest, NextResponse } from "next/server";
import { isGitRepo, expandPath } from "@/lib/git-status";
import { checkGhCli, getPRDiff } from "@/lib/pr";

interface RouteParams {
  params: Promise<{ number: string }>;
}

// GET /api/git/pr/[number]/diff
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { number: numStr } = await params;
    const prNumber = parseInt(numStr, 10);
    if (isNaN(prNumber)) {
      return NextResponse.json(
        { error: "Invalid PR number" },
        { status: 400 }
      );
    }

    const path = request.nextUrl.searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const expanded = expandPath(path);
    if (!isGitRepo(expanded)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    if (!checkGhCli()) {
      return NextResponse.json(
        { error: "GitHub CLI not available" },
        { status: 400 }
      );
    }

    const diff = getPRDiff(expanded, prNumber);

    // If a specific file is requested, extract just that file's diff
    const file = request.nextUrl.searchParams.get("file");
    if (file) {
      const fileDiff = extractFileDiff(diff, file);
      return NextResponse.json({ diff: fileDiff });
    }

    return NextResponse.json({ diff });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get PR diff",
      },
      { status: 500 }
    );
  }
}

/**
 * Extract a single file's diff from a full PR diff
 */
function extractFileDiff(fullDiff: string, filePath: string): string {
  const lines = fullDiff.split("\n");
  let capture = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      if (capture) break; // We've finished our file's diff
      // Check if this diff block is for our file
      if (line.includes(`b/${filePath}`)) {
        capture = true;
      }
    }
    if (capture) {
      result.push(line);
    }
  }

  return result.join("\n");
}
