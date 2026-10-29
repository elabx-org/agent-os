import { NextResponse } from "next/server";

// GET /api/user-proof - the page the client loads in a hidden iframe; being
// a navigation, server.ts sets the user-proof cookie on the way
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
