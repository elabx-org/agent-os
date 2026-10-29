import { NextResponse } from "next/server";

// GET /api/worktree-moves → MovesList: every scheduled, running or failed
// move, for Now's "Moving…" (M5, lib/worktree-move.ts)
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
