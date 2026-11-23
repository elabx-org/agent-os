import { NextResponse } from "next/server";
import http from "http";
import { ownerRead, ownerWrite } from "@/lib/backup/owner";
import { sweepMachine, syncView } from "@/lib/backup/hub-send";
import { cleanShare, setMachineShare } from "@/lib/backup/share";
import { OWN_PROOF_HEADER, ownProof } from "@/lib/link/own-proof";
import { machineById } from "@/lib/link/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const noStore = { "Cache-Control": "no-store" };
const noMachine = () =>
  NextResponse.json({ error: "No such machine" }, { status: 404 });

/** Asks the machine to send what changed there too; its answer isn't waited on */
function askMachine(id: string): void {
  const request = http.request({
    host: "127.0.0.1",
    port: Number(process.env.PORT || "3011"),
    method: "POST",
    path: `/m/${id}/api/link/inbox/peer/sweep`,
    headers: { [OWN_PROOF_HEADER]: ownProof(), "content-length": "0" },
  });
  request.on("response", (res) => res.resume());
  request.on("error", () => {});
  request.end();
}

// GET /api/machines/[id]/sync - SyncView: what is shared with the machine
// and how each copy between it and this server stands
export async function GET(request: Request, { params }: Context) {
  const no = ownerRead(request);
  if (no) return no;
  const machine = machineById((await params).id);
  if (!machine) return noMachine();
  return NextResponse.json(syncView(machine), { headers: noStore });
}

// PUT /api/machines/[id]/sync { level, projects } - which of this server's
// sessions the machine gets copies of. The user's alone
export async function PUT(request: Request, { params }: Context) {
  const no = ownerWrite(request);
  if (no) return no;
  const { id } = await params;
  if (!machineById(id)) return noMachine();
  const share = cleanShare(await request.json().catch(() => null));
  if (!share) {
    return NextResponse.json(
      { error: "That isn't a sharing choice" },
      { status: 400 }
    );
  }
  setMachineShare(id, share);
  const machine = machineById(id)!;
  // What is no longer shared goes from the machine now; the rest is copied
  void sweepMachine(machine).catch(() => {});
  return NextResponse.json(syncView(machine), { headers: noStore });
}

// POST /api/machines/[id]/sync - "Sync now": both sides send what changed
export async function POST(request: Request, { params }: Context) {
  const no = ownerWrite(request);
  if (no) return no;
  const machine = machineById((await params).id);
  if (!machine) return noMachine();
  await sweepMachine(machine).catch(() => {});
  if (machine.backup === 1) askMachine(machine.id);
  return NextResponse.json(syncView(machine), { headers: noStore });
}
