import { NextResponse } from "next/server";
import { here, hubNameHere } from "@/lib/backup/peer";
import { copyTotals } from "@/lib/backup/store";
import { offlineNeeded } from "@/lib/backup/takeover";
import { hubOfflineFor, hubUp, isMachineMode } from "@/lib/link/machine";
import { HUB_PEER } from "@/lib/link/protocol";

export const dynamic = "force-dynamic";

// GET /api/hub - on a linked machine: whether it can ask its server, what
// the server lets its sessions do, and (for its own window while the
// server is off) how many of the server's sessions it keeps a copy of.
// { linked: false } on a server
export async function GET() {
  if (!isMachineMode()) {
    return NextResponse.json(
      { linked: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const totals = copyTotals(HUB_PEER);
  const offlineMs = hubOfflineFor();
  return NextResponse.json(
    {
      ...hubUp(),
      machine: true,
      hubName: hubNameHere(),
      name: here().name,
      offlineMs,
      // Long enough off that a copy may be continued here
      canContinue: offlineMs >= offlineNeeded(),
      copies: totals.copies,
      newestCopyAt: totals.newestCopyAt,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
