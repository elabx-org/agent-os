import { NextRequest, NextResponse } from "next/server";
import { getCommitHistory } from "@/lib/git-history";
import { expandPath } from "@/lib/git-status";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawPath = searchParams.get("path");
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 30;

    if (!rawPath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    const path = expandPath(rawPath);
    const commits = getCommitHistory(path, limit);
    return NextResponse.json({ commits });
  } catch (error) {
    console.error("Error getting commit history:", error);
    return NextResponse.json(
      { error: "Failed to get commit history" },
      { status: 500 }
    );
  }
}
