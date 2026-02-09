import { NextRequest, NextResponse } from "next/server";
import {
  isGitRepo,
  expandPath,
  getGitStatus,
  checkoutBranch,
  getBranchList,
} from "@/lib/git-status";

/**
 * POST /api/git/checkout
 * Switch to a different branch
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: rawPath, branch, force } = body as {
      path: string;
      branch: string;
      force?: boolean;
    };

    if (!rawPath || !branch) {
      return NextResponse.json(
        { error: "Path and branch are required" },
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

    // Check if branch exists
    const { branches, current } = getBranchList(path);
    if (!branches.includes(branch)) {
      return NextResponse.json(
        { error: `Branch '${branch}' does not exist` },
        { status: 400 }
      );
    }

    if (branch === current) {
      return NextResponse.json({
        success: true,
        branch,
        switched: false,
        message: "Already on this branch",
      });
    }

    // Check for uncommitted changes unless force is set
    if (!force) {
      const status = getGitStatus(path);
      const hasChanges =
        status.staged.length > 0 ||
        status.unstaged.length > 0 ||
        status.untracked.length > 0;

      if (hasChanges) {
        return NextResponse.json({
          success: false,
          dirty: true,
          staged: status.staged.length,
          unstaged: status.unstaged.length,
          untracked: status.untracked.length,
        });
      }
    }

    checkoutBranch(path, branch);

    return NextResponse.json({
      success: true,
      branch,
      switched: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to switch branch",
      },
      { status: 500 }
    );
  }
}
