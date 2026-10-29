import { NextRequest, NextResponse } from "next/server";

// GET /api/sessions/[id]/tree - the session's family tree of agents
// (AgentTreeResponse, lib/agent-tree-types.ts): workflows → phases →
// agents, plain subagents, forks and handoffs, workers, background agents
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
