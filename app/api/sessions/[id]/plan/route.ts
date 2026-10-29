import { NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import type { PlanResponse } from "@/lib/claude-plan";
import { planOfTranscript } from "@/lib/claude-plan-tail";
import { locateTranscript } from "@/lib/transcript-locate";

const NONE: PlanResponse = { plan: null, tokens: null };

// GET /api/sessions/[id]/plan -> PlanResponse: Claude's plan (latest
// TodoWrite / task calls) and the context size, from the transcript (its
// tail, then only what was appended since the last poll)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.agent_type && session.agent_type !== "claude") {
    return NextResponse.json(NONE);
  }

  const found = await locateTranscript(session);
  if (!found?.file) return NextResponse.json(NONE);
  try {
    return NextResponse.json(await planOfTranscript(found.file));
  } catch (error) {
    console.error("Error reading the plan:", error);
    return NextResponse.json(NONE);
  }
}
