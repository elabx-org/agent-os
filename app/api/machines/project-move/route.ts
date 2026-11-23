import { NextResponse } from "next/server";
import { shareSentProject } from "@/lib/backup/place";
import { MoveNotPossible } from "@/lib/link/move";
import { projectMoveJob, startProjectMove } from "@/lib/link/project-move";
import { machinesOn } from "@/lib/link/server";
import { isUserPageRequest, requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

const ID = /^[\w-]{1,100}$/;
const MACHINE = /^(hub|m_[0-9a-f]{12})$/;

// POST /api/machines/project-move - { projectId?, projectName, from, to,
// sessions: [{ id, name }] }: continues a project on another machine
// (lib/link/project-move.ts); answers the ProjectMoveJob to poll
export async function POST(request: Request) {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  // Where a project and its chats run is the user's call
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    projectId?: unknown;
    projectName?: unknown;
    from?: unknown;
    to?: unknown;
    sessions?: unknown;
  };
  const sessions = Array.isArray(body.sessions) ? body.sessions : null;
  if (
    !(
      body.projectId === undefined ||
      (typeof body.projectId === "string" && ID.test(body.projectId))
    ) ||
    typeof body.projectName !== "string" ||
    body.projectName.length > 200 ||
    typeof body.from !== "string" ||
    !MACHINE.test(body.from) ||
    typeof body.to !== "string" ||
    !MACHINE.test(body.to) ||
    !sessions ||
    sessions.length > 100 ||
    !sessions.every(
      (s) =>
        !!s &&
        typeof s.id === "string" &&
        ID.test(s.id) &&
        typeof s.name === "string" &&
        s.name.length <= 300
    ) ||
    (sessions.length === 0 && body.projectId === undefined)
  ) {
    return NextResponse.json(
      { error: "Which project, to where?" },
      { status: 400 }
    );
  }
  try {
    const job = startProjectMove(request, {
      projectId: body.projectId as string | undefined,
      projectName: body.projectName,
      from: body.from,
      to: body.to,
      sessions: sessions.map((s) => ({ id: s.id, name: s.name })),
    });
    // Sent from this server to a machine: the project is on both from now
    // on, so its chats that stay here are copied there as well
    if (body.from === "hub" && body.to !== "hub" && body.projectId) {
      try {
        shareSentProject(body.to, body.projectId as string);
      } catch (error) {
        console.error("[share] marking a sent project:", error);
      }
    }
    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof MoveNotPossible) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

// GET /api/machines/project-move?id= - how far it is
export async function GET(request: Request) {
  if (!machinesOn() || !isUserPageRequest(request)) {
    return NextResponse.json({ error: "user_only" }, { status: 403 });
  }
  const job = projectMoveJob(new URL(request.url).searchParams.get("id") ?? "");
  return job
    ? NextResponse.json(job)
    : NextResponse.json({ error: "No such move" }, { status: 404 });
}
