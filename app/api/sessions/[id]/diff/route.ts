import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { DiffRequestError, sessionDiff } from "@/lib/turns-diff";

// GET /api/sessions/[id]/diff?scope=turn:<n>|branch|uncommitted&file= -
// SessionDiff for the session's folder; `file` is a path in its repo
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const url = request.nextUrl;
  try {
    const diff = await sessionDiff(
      session,
      url.searchParams.get("scope"),
      url.searchParams.get("file")
    );
    if (!diff) {
      return NextResponse.json({ error: "Turn not found" }, { status: 404 });
    }
    return NextResponse.json(diff);
  } catch (error) {
    if (error instanceof DiffRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Session diff failed:", error);
    return NextResponse.json({ error: "Diff failed" }, { status: 500 });
  }
}
