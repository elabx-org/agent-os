import { NextRequest, NextResponse } from "next/server";
import { isGitRepo, expandPath } from "@/lib/git-status";
import { checkGhCli, getPRComments, addPRComment } from "@/lib/pr";

interface RouteParams {
  params: Promise<{ number: string }>;
}

// GET /api/git/pr/[number]/comments
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

    const comments = getPRComments(expanded, prNumber);
    return NextResponse.json({ comments });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to get PR comments",
      },
      { status: 500 }
    );
  }
}

// POST /api/git/pr/[number]/comments - Add a comment
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { number: numStr } = await params;
    const prNumber = parseInt(numStr, 10);
    if (isNaN(prNumber)) {
      return NextResponse.json(
        { error: "Invalid PR number" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { path, body: commentBody } = body as {
      path: string;
      body: string;
    };

    if (!path || !commentBody) {
      return NextResponse.json(
        { error: "Path and body are required" },
        { status: 400 }
      );
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

    addPRComment(expanded, prNumber, commentBody);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to add comment",
      },
      { status: 500 }
    );
  }
}
