import { NextResponse } from "next/server";
import { planMove } from "@/lib/link/move";
import { machinesOn } from "@/lib/link/server";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

const SESSION_ID = /^[\w-]+$/;
const MACHINE = /^(hub|m_[0-9a-f]{12})$/;

// POST /api/machines/move/plan - { sessionId, from, to }: where the
// session would land on the other machine (a MovePlan); changes nothing
export async function POST(request: Request) {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
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
    !MACHINE.test(body.to) ||
    body.from === body.to
  ) {
    return NextResponse.json(
      { error: "Which session, to where?" },
      { status: 400 }
    );
  }
  const plan = await planMove(request, {
    sessionId: body.sessionId,
    from: body.from,
    to: body.to,
  });
  return plan
    ? NextResponse.json(plan)
    : NextResponse.json({ error: "Couldn't ask it" }, { status: 502 });
}
