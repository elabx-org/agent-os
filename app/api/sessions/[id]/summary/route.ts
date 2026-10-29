import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { getSessionSummary } from "@/lib/session-summaries";
import type { SessionSummaryResponse } from "@/lib/session-attach-types";

// GET /api/sessions/[id]/summary[?fresh=1] - SessionSummaryResponse: what
// a message attaching this session (@, M9) carries. Cached in
// session_summaries until the transcript grows. No model call.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    const fresh = request.nextUrl.searchParams.get("fresh") === "1";
    const summary: SessionSummaryResponse = await getSessionSummary(session, {
      fresh,
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Session summary failed:", error);
    return NextResponse.json(
      { error: "Session summary failed" },
      { status: 500 }
    );
  }
}
