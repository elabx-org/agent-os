import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { writeProjectContext } from "@/lib/project-context";

// POST /api/sessions/[id]/project-context - write the note a session starts
// with about the other sessions in its project; { file } is null when none
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    return NextResponse.json({ file: await writeProjectContext(session) });
  } catch (error) {
    console.error("Error writing project context:", error);
    return NextResponse.json({ file: null });
  }
}
