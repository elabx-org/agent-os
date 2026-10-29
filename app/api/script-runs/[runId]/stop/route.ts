import { NextResponse } from "next/server";

// POST /api/script-runs/[runId]/stop - {run: ScriptRun}; requireUser.
// M3 contract stub: U3.1 implements

export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
