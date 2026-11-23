import { NextResponse } from "next/server";
import { ownerRead, ownerWrite } from "@/lib/backup/owner";
import { clearMachineCache, machineSpace } from "@/lib/jobs/hub";
import { isMachineMode } from "@/lib/link/machine";

export const dynamic = "force-dynamic";

const MACHINE = /^m_[0-9a-f]{12}$/;
const noStore = { "Cache-Control": "no-store" };

// GET /api/jobs/space?on=m_... - JobSpace: what jobs take on that
// machine's disk (null while it can't be asked). The user's page only
export async function GET(request: Request) {
  const no = ownerRead(request);
  if (no) return no;
  const machine = new URL(request.url).searchParams.get("on") ?? "";
  if (isMachineMode() || !MACHINE.test(machine)) {
    return NextResponse.json({ space: null }, { headers: noStore });
  }
  return NextResponse.json(
    { space: await machineSpace(machine) },
    { headers: noStore }
  );
}

// DELETE /api/jobs/space?on=m_...[&cache=name] - clears the build
// output kept there for one project, or for all. The user's alone
export async function DELETE(request: Request) {
  const no = ownerWrite(request);
  if (no) return no;
  const url = new URL(request.url);
  const machine = url.searchParams.get("on") ?? "";
  const cache = url.searchParams.get("cache");
  if (isMachineMode() || !MACHINE.test(machine)) {
    return NextResponse.json({ error: "Which machine?" }, { status: 400 });
  }
  if (cache !== null && !/^[\w.-]{1,120}$/.test(cache)) {
    return NextResponse.json({ error: "Which project?" }, { status: 400 });
  }
  return (await clearMachineCache(machine, cache))
    ? NextResponse.json({ ok: true }, { headers: noStore })
    : NextResponse.json(
        {
          error:
            "It couldn't be cleared: a job is using it, or the machine is off.",
        },
        { status: 409 }
      );
}
