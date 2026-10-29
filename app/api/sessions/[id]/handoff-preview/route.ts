import { NextResponse } from "next/server";

// GET /api/sessions/[id]/handoff-preview → HandoffPreview (M4,
// lib/handoff.ts; types in lib/handoff-types.ts)
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
