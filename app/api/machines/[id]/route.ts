import { NextResponse } from "next/server";
import { linkHub, machinesOn } from "@/lib/link/server";
import {
  machineById,
  renameMachine,
  setMachineAgents,
  setMachineBackup,
  setMachineUsesHub,
} from "@/lib/link/store";
import { forgetMachine } from "@/lib/backup/store";
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
// { name } renames it; { agents } lets this server's sessions use it, or not;
// { usesHub } lets its sessions use this server, or not; { backup } keeps
// copies of its sessions here, or stops (the copies stay until deleted)
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
    usesHub?: unknown;
    backup?: unknown;
  };
  if (typeof body.name === "string") {
    renameMachine(id, body.name);
    // It shows its own name as the server knows it
    linkHub().tellUp(id);
  }
  if (typeof body.agents === "boolean") {
    setMachineAgents(id, body.agents);
    linkHub().tellAgents(id);
  }
  if (typeof body.usesHub === "boolean") {
    setMachineUsesHub(id, body.usesHub);
    linkHub().tellUp(id);
  }
  if (typeof body.backup === "boolean") {
    setMachineBackup(id, body.backup);
    linkHub().tellUp(id);
  }
  if (body.approve === true) linkHub().approve(id);
  const row = machineById(id)!;
  return NextResponse.json({
    id: row.id,
    name: row.name,
    status: row.status,
    presence: linkHub().presence(id),
    agents: row.agents === 1,
    usesHub: row.uses_hub === 1,
    backup: row.backup === 1,
  });
}

// DELETE /api/machines/[id] - cuts the machine off and forgets its key.
// The copies of its sessions go too, except the ones this server continued
// that it never confirmed pausing: those stay, to be paused wherever they
// turn up (lib/backup/store.ts forgetMachine)
export async function DELETE(request: Request, { params }: Context) {
  const no = refuse(request);
  if (no) return no;
  const { id } = await params;
  if (!linkHub().remove(id)) {
    return NextResponse.json({ error: "No such machine" }, { status: 404 });
  }
  await forgetMachine(id).catch((error) =>
    console.error("[machines] dropping its copies:", error)
  );
  return NextResponse.json({ success: true });
}
