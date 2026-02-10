import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepo,
  expandPath,
  getStashList,
  stashSave,
} from "@/lib/git-status";

/**
 * GET /api/git/stash?path=...
 * List all stashes
 */
export async function GET(request: NextRequest) {
  try {
    const path = request.nextUrl.searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const expandedPath = expandPath(path);
    if (!isGitRepo(expandedPath)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    const stashes = getStashList(expandedPath);
    return NextResponse.json({ stashes });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list stashes",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/git/stash
 * Save current changes to stash
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath, message, includeUntracked } = body as {
      path: string;
      message?: string;
      includeUntracked?: boolean;
    };

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const path = expandPath(rawPath);
    if (!isGitRepo(path)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    stashSave(path, message, includeUntracked);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save stash",
      },
      { status: 500 }
    );
  }
}
