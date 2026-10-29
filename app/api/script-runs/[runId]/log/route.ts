import { NextResponse } from "next/server";

// GET /api/script-runs/[runId]/log?lines=N - ScriptRunLogResponse.
// M3 contract stub: U3.1 implements

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
