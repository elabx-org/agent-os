import { NextResponse } from "next/server";
import { agentActorSessionId } from "@/lib/agent-actions";
import { isAgentOrigin } from "@/lib/agent-origin";
import { ownerRead, ownerWrite } from "@/lib/backup/owner";
import { JobRefused, createJob, jobsView, runAgain } from "@/lib/jobs/hub";
import { userNamedMachine } from "@/lib/jobs/named";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const ID = /^[\w-]{1,100}$/;
const MACHINE = /^m_[0-9a-f]{12}$/;

function refused(error: unknown) {
  if (error instanceof JobRefused) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: noStore }
    );
  }
  console.error("[jobs]", error);
  return NextResponse.json({ error: "It didn't work." }, { status: 500 });
}

// GET /api/jobs[?session=&on=m_...&limit=] - JobsView: the jobs chats here
// handed to other machines, newest first, and which machines can take one.
// The user's page sees all; a session's tool only that session's own
export async function GET(request: Request) {
  const url = new URL(request.url);
  let session = url.searchParams.get("session");
  if (isAgentOrigin(request)) {
    session = agentActorSessionId(request);
    if (!session) {
      return NextResponse.json({ error: "Which session?" }, { status: 403 });
    }
  } else {
    const no = ownerRead(request);
    if (no) return no;
  }
  // Not "machine": that name sends a call to the machine itself
  const machine = url.searchParams.get("on");
  if ((session && !ID.test(session)) || (machine && !MACHINE.test(machine))) {
    return NextResponse.json({ error: "Not that" }, { status: 400 });
  }
  return NextResponse.json(
    jobsView({
      session: session ?? undefined,
      machine: machine ?? undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    }),
    { headers: noStore }
  );
}

// POST /api/jobs - a session's tool: { machine, title, task } hands a job to
// that machine. The user's page: { again: <job id> } runs one once more
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    machine?: unknown;
    title?: unknown;
    task?: unknown;
    again?: unknown;
  } | null;
  try {
    if (!isAgentOrigin(request)) {
      const no = ownerWrite(request);
      if (no) return no;
      if (typeof body?.again !== "string") {
        return NextResponse.json({ error: "Which job?" }, { status: 400 });
      }
      return NextResponse.json(
        { job: runAgain(body.again) },
        { headers: noStore }
      );
    }
    const sessionId = agentActorSessionId(request);
    if (!sessionId) {
      return NextResponse.json(
        { error: "Only a session can send a job." },
        { status: 403 }
      );
    }
    if (
      typeof body?.machine !== "string" ||
      typeof body.title !== "string" ||
      typeof body.task !== "string"
    ) {
      return NextResponse.json(
        { error: "A job needs a machine, a title and a task." },
        { status: 400 }
      );
    }
    const job = createJob({
      sessionId,
      machine: body.machine,
      title: body.title,
      task: body.task,
      // Read from the user's own message, not taken on the chat's word
      via: (await userNamedMachine(sessionId, body.machine))
        ? "mention"
        : "chat",
    });
    return NextResponse.json({ job }, { headers: noStore });
  } catch (error) {
    return refused(error);
  }
}
