import { NextResponse } from "next/server";

// POST /api/sessions/[id]/model (M4, lib/handoff.ts; types in
// lib/handoff-types.ts). User-only (requireUser)
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
