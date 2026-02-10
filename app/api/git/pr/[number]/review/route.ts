import { NextRequest, NextResponse } from "next/server";
import { isGitRepo, expandPath } from "@/lib/git-status";
import { checkGhCli, submitPRReview } from "@/lib/pr";

interface RouteParams {
  params: Promise<{ number: string }>;
}

// POST /api/git/pr/[number]/review - Submit a review
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
    const { path, event, body: reviewBody } = body as {
      path: string;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    };

    if (!path || !event) {
      return NextResponse.json(
        { error: "Path and event are required" },
        { status: 400 }
      );
    }

    const validEvents = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
    if (!validEvents.includes(event)) {
      return NextResponse.json(
        { error: "Invalid review event" },
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

    submitPRReview(expanded, prNumber, event, reviewBody);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to submit review",
      },
      { status: 500 }
    );
  }
}
