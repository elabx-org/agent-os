import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepo,
  expandPath,
  getRemoteUrl,
  syncBranch,
} from "@/lib/git-status";

/**
 * POST /api/git/sync
 * Fetch from remote, pull changes, and push local commits
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath } = body as { path: string };

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

    const remoteUrl = getRemoteUrl(path);
    if (!remoteUrl) {
      return NextResponse.json(
        { error: "No remote origin configured" },
        { status: 400 }
      );
    }

    const result = syncBranch(path);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync" },
      { status: 500 }
    );
  }
}
