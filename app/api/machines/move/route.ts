import { NextResponse } from "next/server";
import { MoveNotPossible, moveJob, startMove } from "@/lib/link/move";
import { machinesOn } from "@/lib/link/server";
import { isUserPageRequest, requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

const SESSION_ID = /^[\w-]+$/;
const MACHINE = /^(hub|m_[0-9a-f]{12})$/;

function refuse(request: Request): NextResponse | null {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  // Where a session runs is the user's call
  const proof = requireUser(request);
  return proof.ok
    ? null
    : NextResponse.json(
        { error: "user_only", reason: proof.reason },
        { status: 403 }
      );
}

// POST /api/machines/move - { sessionId, from, to } ("hub" or a machine
// id): continues a session on another machine; answers the MoveJob to poll
export async function POST(request: Request) {
  const no = refuse(request);
  if (no) return no;
  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: unknown;
    from?: unknown;
    to?: unknown;
  };
  if (
    typeof body.sessionId !== "string" ||
    !SESSION_ID.test(body.sessionId) ||
    typeof body.from !== "string" ||
    !MACHINE.test(body.from) ||
    typeof body.to !== "string" ||
    !MACHINE.test(body.to)
  ) {
    return NextResponse.json(
      { error: "Which session, to where?" },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(
      startMove(request, {
        sessionId: body.sessionId,
        from: body.from,
        to: body.to,
      })
    );
  } catch (error) {
    if (error instanceof MoveNotPossible) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

// GET /api/machines/move?id= - how far a move is
export async function GET(request: Request) {
  // A same-origin GET carries no Origin: the page's own read
  if (!machinesOn() || !isUserPageRequest(request)) {
    return NextResponse.json({ error: "user_only" }, { status: 403 });
  }
  const job = moveJob(new URL(request.url).searchParams.get("id") ?? "");
  return job
    ? NextResponse.json(job)
    : NextResponse.json({ error: "No such move" }, { status: 404 });
}
