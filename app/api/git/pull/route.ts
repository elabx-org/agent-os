import { NextRequest, NextResponse } from "next/server";
import { expandPath, isGitRepo } from "@/lib/git-status";
import { forgetBranchInfo } from "@/lib/git-branch-info";
import { pullFastForward } from "@/lib/git-pull";
import type { PullResponse } from "@/lib/git-types";

// POST /api/git/pull {path} -> PullResponse: fast-forward from the upstream
// (E-Git's column Pull); refused when it would need a merge
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

    const result = await pullFastForward(path);
    forgetBranchInfo(path);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: result.reason === "no-upstream" ? 400 : 409 }
      );
    }
    const body: PullResponse = { output: result.output };
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to pull" },
      { status: 500 }
    );
  }
}
