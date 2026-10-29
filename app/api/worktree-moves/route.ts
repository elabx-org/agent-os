import { NextResponse } from "next/server";
import { listMoves } from "@/lib/worktree-move";
import type { MovesList } from "@/lib/worktree-move-types";

// Live state: never prerendered at build
export const dynamic = "force-dynamic";

// GET /api/worktree-moves → MovesList: every scheduled, running or failed
// move, for Now's "Moving…" (M5, lib/worktree-move.ts)
export async function GET() {
  const list: MovesList = { moves: listMoves() };
  return NextResponse.json(list);
}
