import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { HandoffRefused, resumePaused } from "@/lib/handoff";
import type { ResumePausedResult } from "@/lib/handoff-types";

// POST /api/sessions/[id]/resume-paused {force?} - ResumePausedResult. The
// user's only. Restarts a handed-off session (Claude with --resume); 409
// successor_live while the session it went to still runs in the same
// folder, unless force.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const force = body?.force === true;

  try {
    const result: ResumePausedResult = await resumePaused(session, { force });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HandoffRefused) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("Resume failed:", error);
    return NextResponse.json({ error: "Resume failed" }, { status: 500 });
  }
}
