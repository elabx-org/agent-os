import { NextResponse } from "next/server";
import { planMoveIn } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

// POST /api/session-moves/plan - { sessionId, name, remote }: where that
// session's repository would go on this machine; changes nothing
export async function POST(request: Request) {
  const no = userOnly(request);
  if (no) return no;
  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: unknown;
    name?: unknown;
    remote?: unknown;
  };
  if (
    typeof body.sessionId !== "string" ||
    !/^[\w-]{1,100}$/.test(body.sessionId) ||
    typeof body.name !== "string" ||
    body.name.length > 300 ||
    !(
      body.remote === null ||
      (typeof body.remote === "string" && body.remote.length <= 2000)
    )
  ) {
    return NextResponse.json({ error: "Which repository?" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await planMoveIn(body.sessionId, body.name, body.remote)
    );
  } catch (error) {
    return moveError(error);
  }
}
