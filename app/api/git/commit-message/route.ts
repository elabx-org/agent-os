import { NextRequest, NextResponse } from "next/server";
import { expandPath, isGitRepo } from "@/lib/git-status";
import {
  generateCommitMessage,
  NothingToDescribeError,
} from "@/lib/commit-message";
import type { CommitMessageResponse } from "@/lib/git-types";

// POST /api/git/commit-message {path} -> CommitMessageResponse: a message
// for what's changed there, written by Claude (D-Git's "Write with Claude")
export async function POST(request: NextRequest) {
  try {
    const { path: rawPath } = (await request.json()) as { path?: string };
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

    const body: CommitMessageResponse = {
      message: await generateCommitMessage(path),
    };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof NothingToDescribeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to write a commit message",
      },
      { status: 500 }
    );
  }
}
