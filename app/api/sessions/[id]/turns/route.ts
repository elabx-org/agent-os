import { NextResponse } from "next/server";

// M2 contract: GET -> TurnsResponse (lib/turn-types.ts). U2.2

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
