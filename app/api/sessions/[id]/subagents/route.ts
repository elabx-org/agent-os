import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript } from "@/lib/claude-transcript";
import { listSubagents } from "@/lib/claude-subagents";

// GET /api/sessions/[id]/subagents - the subagents the session's Claude
// conversation has started, with what each is doing
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session || session.agent_type !== "claude") {
    return NextResponse.json({ subagents: [] });
  }
  const found = await findTranscript(session.tmux_name || `claude-${id}`);
  return NextResponse.json({
    subagents: found?.file ? listSubagents(found.file) : [],
  });
}
