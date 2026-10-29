import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { flagOnFor } from "@/lib/flags";
import { listTurns } from "@/lib/turns";
import type { TurnsResponse } from "@/lib/turn-types";

// GET /api/sessions/[id]/turns - TurnsResponse: the session's turns, oldest
// first, each with its changed files. Empty while snapshots are off for it.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const response: TurnsResponse = {
    turns: await listTurns(session),
    enabled: flagOnFor("snapshots", id),
  };
  return NextResponse.json(response);
}
