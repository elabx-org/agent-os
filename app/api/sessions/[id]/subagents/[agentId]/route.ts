import { NextRequest, NextResponse } from "next/server";

// GET /api/sessions/[id]/subagents/[agentId] - one subagent's detail
// (SubagentDetail, lib/agent-tree-types.ts): its prompt, last four tool
// calls, files written, usage and context window
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  await params;
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
