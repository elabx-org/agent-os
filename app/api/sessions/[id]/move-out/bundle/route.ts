import fs from "fs";
import { Readable } from "stream";
import { bundleOut } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// POST /api/sessions/[id]/move-out/bundle - { moveId, have: sha[] }: a git
// bundle of what the other machine lacks; 204 when it has everything
export async function POST(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    moveId?: string;
    have?: unknown;
  };
  try {
    const file = await bundleOut(id, body.moveId ?? "", body.have);
    if (!file) return new Response(null, { status: 204 });
    return new Response(
      Readable.toWeb(fs.createReadStream(file)) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return moveError(error);
  }
}
