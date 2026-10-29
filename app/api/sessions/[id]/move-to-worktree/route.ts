import { NextResponse } from "next/server";

// POST /api/sessions/[id]/move-to-worktree {branch, folder?, takeChanges}
// → MoveResult; DELETE cancels a scheduled move → CancelMoveResult (M5,
// lib/worktree-move.ts; types in lib/worktree-move-types.ts). Both
// user-only (requireUser)
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
