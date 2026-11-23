import { NextResponse } from "next/server";
import { sweep } from "@/lib/backup/machine";
import { HUB_PEER } from "@/lib/link/protocol";
import { requireLinkMachine } from "@/lib/link/up-guard";

export const dynamic = "force-dynamic";

// POST /api/link/inbox/peer/sweep - on a linked machine: its hub asks it to
// send what changed now ("Sync now"). From the hub through the link only
export async function POST(request: Request) {
  const link = requireLinkMachine(request);
  if (!link.ok) return link.response;
  if (link.machine.id !== HUB_PEER) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  void sweep().catch((error) => console.error("[backup] sweep:", error));
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
