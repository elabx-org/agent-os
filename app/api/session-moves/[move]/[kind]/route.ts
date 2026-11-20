import { NextResponse } from "next/server";
import { receiveMoveFile } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ move: string; kind: string }> };

// PUT /api/session-moves/[move]/bundle|transcript - one of the two files
export async function PUT(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { move, kind } = await params;
  if (kind !== "bundle" && kind !== "transcript") {
    return NextResponse.json({ error: "No such file" }, { status: 404 });
  }
  try {
    return NextResponse.json({
      bytes: await receiveMoveFile(move, kind, request.body),
    });
  } catch (error) {
    return moveError(error);
  }
}
