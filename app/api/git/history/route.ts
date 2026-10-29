import { NextRequest, NextResponse } from "next/server";
import { getCommitHistory, resolveHistoryRef } from "@/lib/git-history";
import { expandPath } from "@/lib/git-status";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawPath = searchParams.get("path");
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 30;
    const rawRef = searchParams.get("ref");

    if (!rawPath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    const path = expandPath(rawPath);

    // Another branch's history (D-Git's main): a branch, else origin's copy
    let ref: string | undefined;
    if (rawRef) {
      const resolved = await resolveHistoryRef(path, rawRef);
      if (!resolved) {
        return NextResponse.json(
          { error: `Unknown ref: ${rawRef}` },
          { status: 400 }
        );
      }
      ref = resolved;
    }

    const commits = await getCommitHistory(
      path,
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 30,
      ref
    );
    return NextResponse.json({ commits });
  } catch (error) {
    console.error("Error getting commit history:", error);
    return NextResponse.json(
      { error: "Failed to get commit history" },
      { status: 500 }
    );
  }
}
