import { NextRequest, NextResponse } from "next/server";
import { listAgentActions } from "@/lib/agent-actions";

// GET /api/sessions/[id]/agent-actions?since=ms - {actions: AgentAction[]}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const since = Number(request.nextUrl.searchParams.get("since")) || 0;
  return NextResponse.json({ actions: listAgentActions(id, since) });
}
