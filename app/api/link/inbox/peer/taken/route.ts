import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/backup/inbox";
import { pauseForMachine } from "@/lib/backup/peer-taken";
import { HUB_PEER } from "@/lib/link/protocol";
import { machinesOn } from "@/lib/link/server";
import { requireLinkMachine } from "@/lib/link/up-guard";

export const dynamic = "force-dynamic";

// POST /api/link/inbox/peer/taken { list: TakenSession[] } - a linked
// machine's AgentOS says which of this server's sessions it carried on
// from its copies while this server was off. This server pauses its own
// and answers { results: TakenResult[] }. Through the link only
export async function POST(request: Request) {
  if (!machinesOn()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const link = requireLinkMachine(request);
  if (!link.ok) return link.response;
  if (link.machine.id === HUB_PEER) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const results = await pauseForMachine(
      link.machine,
      await jsonBody(request)
    );
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[take] pausing for a machine:", error);
    return NextResponse.json(
      { error: "It couldn't be paused" },
      { status: 500 }
    );
  }
}
