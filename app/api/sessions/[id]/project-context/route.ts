import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { writeProjectContext } from "@/lib/project-context";

// POST /api/sessions/[id]/project-context - write what a session starts with
// in its project: { file } the note (null when none), { settings } its hooks
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
    return NextResponse.json(await writeProjectContext(session));
  } catch (error) {
    console.error("Error writing project context:", error);
    return NextResponse.json({ file: null, settings: null });
  }
}
