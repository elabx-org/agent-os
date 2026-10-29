import { NextResponse } from "next/server";

// GET /api/sessions/[id]/move-to-worktree/preview → MovePreview (M5,
// lib/worktree-move.ts; types in lib/worktree-move-types.ts)
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
