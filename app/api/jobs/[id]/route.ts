import { NextResponse } from "next/server";
import { agentActorSessionId } from "@/lib/agent-actions";
import { isAgentOrigin } from "@/lib/agent-origin";
import { ownerRead, ownerWrite } from "@/lib/backup/owner";
import { JobRefused, jobView, stopJob, waitForJob } from "@/lib/jobs/hub";
import type { Job } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ id: string }> };

/** The asking session for a tool's call; undefined for the user's page */
function asker(
  request: Request,
  write: boolean
): { session?: string } | { no: Response } {
  if (isAgentOrigin(request)) {
    const session = agentActorSessionId(request);
    return session
      ? { session }
      : { no: NextResponse.json({ error: "Which session?" }, { status: 403 }) };
  }
  const no = write ? ownerWrite(request) : ownerRead(request);
  return no ? { no } : {};
}

// GET /api/jobs/[id][?wait=seconds] - one job. With wait, answers when it is
// over or needs the user, or after that long
export async function GET(request: Request, { params }: Context) {
  const who = asker(request, false);
  if ("no" in who) return who.no;
  const { id } = await params;
  const wait = Number(new URL(request.url).searchParams.get("wait")) || 0;
  const mine = (job: Job | null): job is Job =>
    !!job && (!who.session || job.sessionId === who.session);
  // Whose it is, before anything waits on it
  if (!mine(jobView(id))) {
    return NextResponse.json({ error: "No such job" }, { status: 404 });
  }
  const job = wait > 0 ? await waitForJob(id, wait * 1000) : jobView(id);
  if (!mine(job)) {
    return NextResponse.json({ error: "No such job" }, { status: 404 });
  }
  return NextResponse.json({ job }, { headers: noStore });
}

// DELETE /api/jobs/[id] - stops it: its session and folder on the machine go
export async function DELETE(request: Request, { params }: Context) {
  const who = asker(request, true);
  if ("no" in who) return who.no;
  const { id } = await params;
  try {
    const job = await stopJob(id, who.session);
    return job
      ? NextResponse.json({ job }, { headers: noStore })
      : NextResponse.json({ error: "No such job" }, { status: 404 });
  } catch (error) {
    if (error instanceof JobRefused) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("[jobs] stop:", error);
    return NextResponse.json({ error: "It didn't work." }, { status: 500 });
  }
}
