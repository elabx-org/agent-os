import { NextResponse } from "next/server";
import { takeAbilities } from "@/lib/abilities-view";
import { backupFailed, jsonBody } from "@/lib/backup/inbox";
import { HUB_PEER } from "@/lib/link/protocol";
import { machinesOn } from "@/lib/link/server";
import { requireLinkMachine } from "@/lib/link/up-guard";

export const dynamic = "force-dynamic";

// POST /api/link/inbox/peer/abilities { abilities } - a linked machine's
// AgentOS says what that machine can do (lib/abilities-types.ts); this
// server keeps it and answers with its own. Through the link only
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
    const answer = await takeAbilities(
      link.machine.id,
      await jsonBody(request)
    );
    if (!answer) {
      return NextResponse.json({ error: "Not that" }, { status: 400 });
    }
    return NextResponse.json(answer, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return backupFailed(error, "abilities");
  }
}
