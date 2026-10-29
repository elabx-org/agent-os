import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript } from "@/lib/claude-transcript";
import { subagentDetail } from "@/lib/claude-subagents";

const AGENT_ID = /^[\w-]+$/;

// GET /api/sessions/[id]/subagents/[agentId] - one subagent's detail
// (SubagentDetail, lib/agent-tree-types.ts): its prompt, last four tool
// calls, files written, usage and context window. Read incrementally and
// cached by file (lib/agent-tree-log.ts), so the 3s poll stays cheap.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id, agentId } = await params;
  if (!AGENT_ID.test(agentId))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session || session.agent_type !== "claude")
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const found = await findTranscript(session.tmux_name || `claude-${id}`);
  try {
    const detail = found?.file
      ? await subagentDetail(found.file, agentId, [
          found.cwd,
          session.worktree_path ?? "",
          session.working_directory,
        ])
      : null;
    if (!detail)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    console.error("Error reading subagent detail:", error);
    return NextResponse.json(
      { error: "Couldn't read the agent" },
      { status: 500 }
    );
  }
}
