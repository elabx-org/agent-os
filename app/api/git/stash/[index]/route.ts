import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepo,
  expandPath,
  stashApply,
  stashPop,
  stashDrop,
  stashShow,
} from "@/lib/git-status";

/**
 * GET /api/git/stash/[index]?path=...
 * Show stash diff
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index: indexStr } = await params;
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      return NextResponse.json(
        { error: "Invalid stash index" },
        { status: 400 }
      );
    }

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

    const diff = stashShow(expandedPath, index);
    return NextResponse.json({ diff });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to show stash",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/git/stash/[index]
 * Apply, pop, or drop a stash
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ index: string }> }
) {
  try {
    const { index: indexStr } = await params;
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      return NextResponse.json(
        { error: "Invalid stash index" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { path: rawPath, action } = body as {
      path: string;
      action: "apply" | "pop" | "drop";
    };

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }
    if (!action || !["apply", "pop", "drop"].includes(action)) {
      return NextResponse.json(
        { error: "Action must be 'apply', 'pop', or 'drop'" },
        { status: 400 }
      );
    }

    const path = expandPath(rawPath);
    if (!isGitRepo(path)) {
      return NextResponse.json(
        { error: "Not a git repository" },
        { status: 400 }
      );
    }

    let output = "";
    switch (action) {
      case "apply":
        output = stashApply(path, index);
        break;
      case "pop":
        output = stashPop(path, index);
        break;
      case "drop":
        stashDrop(path, index);
        break;
    }

    return NextResponse.json({ success: true, output });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to perform stash action",
      },
      { status: 500 }
    );
  }
}
