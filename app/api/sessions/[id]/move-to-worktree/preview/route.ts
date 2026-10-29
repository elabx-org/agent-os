import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { movePreview } from "@/lib/worktree-move";
import type { MovePreview } from "@/lib/worktree-move-types";

// GET /api/sessions/[id]/move-to-worktree/preview → MovePreview: the
// sheet's data (uncommitted files, suggested branch and folder, staged,
// other sessions in the folder, busy, why it can't move, a pending move)
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
    const preview: MovePreview = await movePreview(session);
    return NextResponse.json(preview);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Move preview failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
