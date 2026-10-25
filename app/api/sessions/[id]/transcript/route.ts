import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript, readTranscript } from "@/lib/claude-transcript";

// GET /api/sessions/[id]/transcript?since=<offset>&sid=<claude session id>
// First call (no since) returns the recent history; later calls return what
// was appended. A different Claude session (e.g. after /clear) resets.
// ?before=<start>&sid=... returns the page of history above `start`.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.agent_type && session.agent_type !== "claude") {
    return NextResponse.json({ unsupported: true });
  }

  const tmuxName = session.tmux_name || `claude-${id}`;
  const found = await findTranscript(tmuxName);
  if (!found) return NextResponse.json({ notFound: true });

  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const sinceParam = url.searchParams.get("since");
  const reset = !!sid && sid !== found.sessionId;
  const since = sinceParam !== null && !reset ? Number(sinceParam) : undefined;
  const beforeParam = url.searchParams.get("before");
  const before =
    beforeParam !== null && !reset ? Number(beforeParam) : undefined;

  if (!found.file) {
    return NextResponse.json({
      sessionId: found.sessionId,
      items: [],
      offset: 0,
      start: 0,
      truncated: false,
      reset,
    });
  }

  try {
    const chunk = readTranscript(
      found.file,
      found.sessionId,
      found.cwd,
      since,
      before
    );
    return NextResponse.json({ ...chunk, reset });
  } catch (error) {
    console.error("Error reading transcript:", error);
    return NextResponse.json({ notFound: true });
  }
}
