import { NextResponse } from "next/server";

// POST /api/presence PresenceRequest - 204 (M8, lib/presence.ts)
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
