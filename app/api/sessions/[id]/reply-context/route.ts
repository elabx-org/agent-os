import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { sessionReplyContext } from "@/lib/session-reply-context";

// GET /api/sessions/[id]/reply-context - What a reply answers: the question
// Claude is waiting on or its last message ({ context: null } if nothing)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    return NextResponse.json({ context: await sessionReplyContext(session) });
  } catch (error) {
    console.error("Error reading reply context:", error);
    return NextResponse.json({ context: null });
  }
}
