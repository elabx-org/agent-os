import { NextResponse } from "next/server";

// GET /api/projects/[id]/merged-today - { prs } merged today
// (lib/merged-today.ts MergedTodayResponse). M1b U1b.1 implements it.
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
