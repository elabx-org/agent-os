import { NextResponse } from "next/server";

// POST /api/projects/[id]/scripts/[scriptId]/run {sessionId?} -
// RunScriptResponse; requireUser; 409 UntrustedConfigError until the hash
// is approved. M3 contract stub: U3.1 implements

export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
