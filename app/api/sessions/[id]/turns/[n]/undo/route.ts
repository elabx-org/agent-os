import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { TurnError, turnDetail, undoTurn } from "@/lib/turns";
import { agentIdle } from "@/lib/turns-busy";
import type { UndoResult } from "@/lib/turn-types";

// POST /api/sessions/[id]/turns/[n]/undo {paths} - UndoResult. The user's
// only, and only while the agent is idle (409 busy). Each selected file
// goes back to its pre content unless it changed since the turn (kept).
// Claude is told with the next message it gets.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> }
) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id, n } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  const turnNo = Number(n);
  if (!session || !Number.isInteger(turnNo) || turnNo < 1) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const paths: unknown = body?.paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.some((p) => typeof p !== "string")
  ) {
    return NextResponse.json({ error: "paths required" }, { status: 400 });
  }

  const detail = await turnDetail(session, turnNo);
  if (!detail) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404 });
  }
  const offered = new Set(
    [...detail.files, ...detail.alsoChanged].map((f) => f.path)
  );
  const unknown = (paths as string[]).filter((p) => !offered.has(p));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "Not changed in this turn", paths: unknown },
      { status: 400 }
    );
  }
  if (!detail.undoable) {
    return NextResponse.json(
      { error: "not_undoable", reason: detail.reason },
      { status: 409 }
    );
  }
  if (!(await agentIdle(session))) {
    return NextResponse.json({ error: "busy" }, { status: 409 });
  }

  try {
    const result: UndoResult = await undoTurn(session, turnNo, paths);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TurnError) {
      return NextResponse.json(
        { error: "not_undoable", reason: error.reason },
        { status: error.reason === "not_found" ? 404 : 409 }
      );
    }
    console.error("Undo failed:", error);
    return NextResponse.json({ error: "Undo failed" }, { status: 500 });
  }
}
