import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepo,
  expandPath,
  fetchRemote,
} from "@/lib/git-status";

/**
 * POST /api/git/fetch
 * Lightweight fetch from remote (read-only — only updates remote tracking branches)
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

    fetchRemote(path);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch" },
      { status: 500 }
    );
  }
}
