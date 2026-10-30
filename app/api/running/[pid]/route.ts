import { NextRequest, NextResponse } from "next/server";
import { stopRunning } from "@/lib/running";
import { requireUser } from "@/lib/user-proof";

type Params = { params: Promise<{ pid: string }> };

// DELETE /api/running/[pid] - stop a server the Running view lists. The
// user's call only: an agent mustn't stop servers through AgentOS
export async function DELETE(request: NextRequest, { params }: Params) {
  const proof = requireUser(request);
  if (!proof.ok)
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  const pid = Number((await params).pid);
  if (!Number.isInteger(pid) || pid <= 1)
    return NextResponse.json({ error: "Unknown process" }, { status: 400 });
  try {
    if (!(await stopRunning(pid)))
      return NextResponse.json(
        { error: "It isn't running from a session" },
        { status: 404 }
      );
    return NextResponse.json({ stopped: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Couldn't stop it" },
      { status: 409 }
    );
  }
}
