import { NextResponse } from "next/server";
import { finishMoveOut } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/sessions/[id]/move-out/finish - { moveId, to: { machine, name } }:
// it runs there now; this row says where it went
export async function POST(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    moveId?: string;
    to?: { machine?: unknown; name?: unknown };
  };
  if (
    typeof body.to?.machine !== "string" ||
    typeof body.to?.name !== "string"
  ) {
    return NextResponse.json({ error: "Where to?" }, { status: 400 });
  }
  try {
    await finishMoveOut(id, body.moveId ?? "", {
      machine: body.to.machine,
      name: body.to.name,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return moveError(error);
  }
}
