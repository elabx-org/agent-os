import { NextRequest, NextResponse } from "next/server";
import {
  getGitStatus,
  isGitRepo,
  getFileDiff,
  getUntrackedFileDiff,
  expandPath,
} from "@/lib/git-status";
import { getBranchInfo } from "@/lib/git-branch-info";
import type { GitStatusResponse } from "@/lib/git-types";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawPath = searchParams.get("path");
  const filePath = searchParams.get("file");
  const staged = searchParams.get("staged") === "true";

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

  try {
    // If file is specified, return diff for that file
    if (filePath) {
      const isUntracked = searchParams.get("untracked") === "true";
      const diff = isUntracked
        ? getUntrackedFileDiff(path, filePath)
        : getFileDiff(path, filePath, staged);
      return NextResponse.json({ diff });
    }

    // Otherwise the full status, with the branch against its base
    const status: GitStatusResponse = {
      ...getGitStatus(path),
      ...(await getBranchInfo(path)),
    };
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get git status",
      },
      { status: 500 }
    );
  }
}
