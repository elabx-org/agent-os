import { NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { abortMoveOut, beginMoveOut } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/sessions/[id]/move-out - pauses the session and packs it for
// another machine; answers its MoveManifest
export async function POST(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "No such session" }, { status: 404 });
  }
  try {
    return NextResponse.json(await beginMoveOut(session));
  } catch (error) {
    return moveError(error);
  }
}

// DELETE /api/sessions/[id]/move-out?move= - it didn't move: starts it
// again here
export async function DELETE(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const move = new URL(request.url).searchParams.get("move") ?? "";
  try {
    await abortMoveOut(id, move);
    return NextResponse.json({ success: true });
  } catch (error) {
    return moveError(error);
  }
}
