import { NextResponse } from "next/server";

// GET /api/projects/[id]/scripts/runs - ScriptRunsResponse (last run per
// script). M3 contract stub: U3.1 implements

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
