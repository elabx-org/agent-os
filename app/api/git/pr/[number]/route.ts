import { NextRequest, NextResponse } from "next/server";
import { isGitRepo, expandPath } from "@/lib/git-status";
import { checkGhCli, getPRDetail } from "@/lib/pr";

interface RouteParams {
  params: Promise<{ number: string }>;
}

// GET /api/git/pr/[number] - Get PR detail
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

    const detail = getPRDetail(expanded, prNumber);
    return NextResponse.json({ pr: detail });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get PR detail",
      },
      { status: 500 }
    );
  }
}
