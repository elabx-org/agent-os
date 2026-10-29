import { NextResponse } from "next/server";

// POST /api/projects/[id]/trust {hash} - approves that config hash;
// requireUser. M3 contract stub: U3.1 implements

export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
