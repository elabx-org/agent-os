import { NextResponse } from "next/server";
import { hubAgents, setHubAgents } from "@/lib/link/machine";
import { userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

// GET /api/link/agents - on a linked machine: whether the server's sessions
// may use it (null when it isn't linked right now)
export async function GET() {
  return NextResponse.json({ allowed: hubAgents() });
}

// PUT /api/link/agents - { allowed }: this machine's owner changes that,
// from the machine itself. The server keeps the setting; this asks it.
export async function PUT(request: Request) {
  const no = userOnly(request);
  if (no) return no;
  const body = (await request.json().catch(() => ({}))) as {
    allowed?: unknown;
  };
  if (typeof body.allowed !== "boolean") {
    return NextResponse.json({ error: "allowed is required" }, { status: 400 });
  }
  if (!setHubAgents(body.allowed)) {
    return NextResponse.json(
      { error: "This machine isn't linked to its server right now" },
      { status: 503 }
    );
  }
  return NextResponse.json({ success: true, allowed: body.allowed });
}
