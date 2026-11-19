import { NextResponse } from "next/server";
import { cancelMoveIn, importMove, moveInState } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ move: string }> };

// GET /api/session-moves/[move] - how far the arrival is (MoveInState)
export async function GET(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  try {
    return NextResponse.json(moveInState((await params).move));
  } catch (error) {
    return moveError(error);
  }
}

// POST /api/session-moves/[move] - both files are here: unpack and resume
export async function POST(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  try {
    return NextResponse.json(importMove((await params).move));
  } catch (error) {
    return moveError(error);
  }
}

// DELETE /api/session-moves/[move] - the move was called off
export async function DELETE(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  try {
    await cancelMoveIn((await params).move);
    return NextResponse.json({ success: true });
  } catch (error) {
    return moveError(error);
  }
}
