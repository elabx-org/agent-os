import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript, readTranscript } from "@/lib/claude-transcript";
import { subagentFile } from "@/lib/claude-subagents";

// GET /api/sessions/[id]/subagents/[agentId]/transcript - one subagent's own
// conversation, paged like the session's (?since=, ?before=)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id, agentId } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session || session.agent_type !== "claude") {
    return NextResponse.json({ notFound: true });
  }
  const found = await findTranscript(session.tmux_name || `claude-${id}`);
  const file = found?.file ? subagentFile(found.file, agentId) : null;
  if (!found || !file) return NextResponse.json({ notFound: true });

  const url = new URL(request.url);
  const num = (key: string) => {
    const v = url.searchParams.get(key);
    return v === null ? undefined : Number(v);
  };
  try {
    return NextResponse.json({
      ...readTranscript(
        file,
        found.sessionId,
        found.cwd,
        num("since"),
        num("before"),
        true
      ),
      reset: false,
    });
  } catch (error) {
    console.error("Error reading subagent transcript:", error);
    return NextResponse.json({ notFound: true });
  }
}
