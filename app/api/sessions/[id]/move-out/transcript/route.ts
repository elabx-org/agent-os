import { Readable } from "stream";
import { transcriptOut } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/sessions/[id]/move-out/transcript?move= - the conversation as a
// tar.gz
export async function GET(request: Request, { params }: Context) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const move = new URL(request.url).searchParams.get("move") ?? "";
  try {
    return new Response(
      Readable.toWeb(transcriptOut(id, move)) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/gzip",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return moveError(error);
  }
}
