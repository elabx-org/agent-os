import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { readPausedHistory } from "@/lib/paused-history";

// GET /api/sessions/[id]/paused-history - { text }: a handed-off (M4) or
// settled (M8) Codex or Gemini session's terminal, as it was when its tmux
// ended (null if none)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ text: readPausedHistory(session.id) });
}
