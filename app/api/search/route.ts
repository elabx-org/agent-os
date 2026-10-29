import { NextResponse } from "next/server";

/**
 * GET /api/search?q=&kind=all|sessions|messages|files|commands&projectId=
 * &sessionId= → SearchResponse (lib/search/types.ts). Sessions first, then
 * messages, files, commands. Owned by U11.2.
 */
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
