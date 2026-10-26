import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { EMPTY_CLAUDE_STATE, readClaudeState } from "@/lib/claude-state";

// GET /api/sessions/[id]/claude-state - what the session's Claude last
// recorded through its hooks and status line: mode, busy, current tool,
// pending permission, model/context/cost. Null fields until it has run
// with them (sessions started before this get them after a restart).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session || session.agent_type !== "claude") {
    return NextResponse.json(EMPTY_CLAUDE_STATE);
  }
  return NextResponse.json(readClaudeState(id));
}
