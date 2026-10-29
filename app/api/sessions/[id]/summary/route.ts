import { NextResponse } from "next/server";

// GET /api/sessions/[id]/summary → SessionSummaryResponse (M9,
// lib/session-summaries.ts; types in lib/session-attach-types.ts). Cached
// in session_summaries until the transcript grows. No model call.
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
