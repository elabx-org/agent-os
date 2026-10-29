import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { MoveRefused, cancelMove, moveToWorktree } from "@/lib/worktree-move";
import type {
  CancelMoveResult,
  MoveRequest,
  MoveResult,
} from "@/lib/worktree-move-types";

function getSession(id: string): Session | null {
  return (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;
}

function refusedOrFailed(error: unknown, what: string) {
  if (error instanceof MoveRefused) {
    return NextResponse.json(error.body, { status: error.status });
  }
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`${what}:`, msg);
  return NextResponse.json({ error: msg }, { status: 500 });
}

// POST /api/sessions/[id]/move-to-worktree {branch, folder?, takeChanges}
// → MoveResult (M5, lib/worktree-move.ts). The user's only. Ready: moved
// now (201). Busy: stored and run at its next idle edge (202, scheduled).
// Refusals carry a MoveError with its reason (lib/worktree-move-types.ts)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Expected a JSON body" },
      { status: 400 }
    );
  }
  const { branch, folder, takeChanges } = body as Record<string, unknown>;
  const move: MoveRequest = {
    branch: branch as string,
    folder: (folder ?? undefined) as string | undefined,
    takeChanges: takeChanges as boolean,
  };

  try {
    const result: MoveResult = await moveToWorktree(session, move);
    return NextResponse.json(result, { status: result.scheduled ? 202 : 201 });
  } catch (error) {
    return refusedOrFailed(error, "Move to a worktree failed");
  }
}

// DELETE /api/sessions/[id]/move-to-worktree → CancelMoveResult: cancels a
// scheduled move until it starts (409 started, 404 not_scheduled). The
// user's only
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    const result: CancelMoveResult = await cancelMove(session);
    return NextResponse.json(result);
  } catch (error) {
    return refusedOrFailed(error, "Cancelling the move failed");
  }
}
