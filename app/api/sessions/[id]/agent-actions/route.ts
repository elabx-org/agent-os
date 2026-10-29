import { NextRequest, NextResponse } from "next/server";

// GET /api/sessions/[id]/agent-actions?since=ms - {actions: AgentAction[]}
export async function GET(
  _request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
