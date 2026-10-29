import { NextRequest, NextResponse } from "next/server";
import { loadAgentTree } from "@/lib/agent-tree";

// GET /api/sessions/[id]/tree - the session's family tree of agents
// (AgentTreeResponse, lib/agent-tree-types.ts): workflows → phases →
// agents, plain subagents, forks and handoffs, workers, background agents
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const tree = await loadAgentTree(id);
    if (!tree)
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json(tree);
  } catch (error) {
    console.error("Error reading the agent tree:", error);
    return NextResponse.json(
      { error: "Couldn't read the agent tree" },
      { status: 500 }
    );
  }
}
