import { NextRequest, NextResponse } from "next/server";
import { isGitRepo, expandPath } from "@/lib/git-status";
import { checkGhCli, mergePR } from "@/lib/pr";

interface RouteParams {
  params: Promise<{ number: string }>;
}

// POST /api/git/pr/[number]/merge - Merge a PR
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
    const { path, method = "squash" } = body as {
      path: string;
      method?: "merge" | "squash" | "rebase";
    };

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const validMethods = ["merge", "squash", "rebase"];
    if (!validMethods.includes(method)) {
      return NextResponse.json(
        { error: "Invalid merge method" },
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

    mergePR(expanded, prNumber, method);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to merge PR",
      },
      { status: 500 }
    );
  }
}
