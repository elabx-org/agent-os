import { NextResponse } from "next/server";
import { linkHub, machinesOn } from "@/lib/link/server";
import { machineById, renameMachine, setMachineAgents } from "@/lib/link/store";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function refuse(request: Request): NextResponse | null {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  // Letting a computer in, or cutting it off, is the user's call
  const proof = requireUser(request);
  return proof.ok
    ? null
    : NextResponse.json(
        { error: "user_only", reason: proof.reason },
        { status: 403 }
      );
}

// PATCH /api/machines/[id] - { approve: true } lets a waiting machine in;
// { name } renames it; { agents } lets this server's sessions use it, or not
export async function PATCH(request: Request, { params }: Context) {
  const no = refuse(request);
  if (no) return no;
  const { id } = await params;
  if (!machineById(id)) {
    return NextResponse.json({ error: "No such machine" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    approve?: unknown;
    name?: unknown;
    agents?: unknown;
  };
  if (typeof body.name === "string") renameMachine(id, body.name);
  if (typeof body.agents === "boolean") {
    setMachineAgents(id, body.agents);
    linkHub().tellAgents(id);
  }
  if (body.approve === true) linkHub().approve(id);
  const row = machineById(id)!;
  return NextResponse.json({
    id: row.id,
    name: row.name,
    status: row.status,
    presence: linkHub().presence(id),
    agents: row.agents === 1,
  });
}

// DELETE /api/machines/[id] - cuts the machine off and forgets its key
export async function DELETE(request: Request, { params }: Context) {
  const no = refuse(request);
  if (no) return no;
  const { id } = await params;
  return linkHub().remove(id)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "No such machine" }, { status: 404 });
}
