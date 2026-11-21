import { NextResponse } from "next/server";
import { ownerRead, ownerWrite } from "@/lib/backup/owner";
import { TakeRefused, startTake, takeJob } from "@/lib/backup/takeover";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; session: string }> };

// POST /api/machines/[id]/backups/[session]/take {settingsOk?} - TakeJob:
// continues the copy on this server (the machine is offline). The user's
// alone. 409 with the reason when it can't
export async function POST(request: Request, { params }: Context) {
  const no = ownerWrite(request);
  if (no) return no;
  const { id, session } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    settingsOk?: unknown;
  };
  try {
    const job = await startTake(id, session, {
      settingsOk: body.settingsOk === true,
    });
    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof TakeRefused) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[take]", error);
    return NextResponse.json(
      { error: "It didn't start here. The copy is untouched." },
      { status: 500 }
    );
  }
}

// GET /api/machines/[id]/backups/[session]/take?job= - how it is going
export async function GET(request: Request, { params }: Context) {
  const no = ownerRead(request);
  if (no) return no;
  const { id, session } = await params;
  const job = takeJob(new URL(request.url).searchParams.get("job") ?? "");
  if (!job || job.machineId !== id || job.sessionId !== session) {
    return NextResponse.json({ error: "No such take-over" }, { status: 404 });
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
