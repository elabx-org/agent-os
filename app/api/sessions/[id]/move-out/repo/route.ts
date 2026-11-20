import { NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { moveRepoOf } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/sessions/[id]/move-out/repo - the repository the session works
// in ({ name, remote }), for the machine it may move to
export async function GET(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "No such session" }, { status: 404 });
  }
  try {
    const repo = await moveRepoOf(session);
    return repo
      ? NextResponse.json(repo)
      : NextResponse.json({ error: "Not a git repository" }, { status: 409 });
  } catch (error) {
    return moveError(error);
  }
}
