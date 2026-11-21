import { NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { hubHolds } from "@/lib/backup/held";
import { parseMovedTo } from "@/lib/session-move-types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/sessions/[id]/held - on a machine, for a session the server
// continued from its copy: {held} (true while the server has it; null when
// the server can't be asked). The bar offers "Resume this copy here" only
// once it is false
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!parseMovedTo(session.moved_to)?.takeover) {
    return NextResponse.json({ held: null });
  }
  return NextResponse.json(
    { held: await hubHolds(id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
