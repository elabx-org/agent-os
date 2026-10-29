import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { turnDetail } from "@/lib/turns";

// GET /api/sessions/[id]/turns/[n] - TurnDetail: what the undo sheet offers
// (the agent's files checked, the rest under "Also changed")
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> }
) {
  const { id, n } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  const turnNo = Number(n);
  if (!session || !Number.isInteger(turnNo) || turnNo < 1) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404 });
  }
  const detail = await turnDetail(session, turnNo);
  if (!detail) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
