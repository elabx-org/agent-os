import { NextResponse } from "next/server";

// GET /api/projects/[id]/config - ProjectConfigResponse
// PUT {config, baseHash, allowFullAccess?} - {hash}; requireUser; 409
// ConfigConflictError when the file moved (lib/project-config-types.ts)
// M3 contract stub: U3.1 implements

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function PUT() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
