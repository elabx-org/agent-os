import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { handoffPreview } from "@/lib/handoff";
import type { HandoffPreview } from "@/lib/handoff-types";

// GET /api/sessions/[id]/handoff-preview - HandoffPreview: what a handoff
// would carry over (extractive summary size, files changed, open plan) and
// whether the session is mid-turn. No model call.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    const preview: HandoffPreview = await handoffPreview(session);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("Handoff preview failed:", error);
    return NextResponse.json(
      { error: "Handoff preview failed" },
      { status: 500 }
    );
  }
}
