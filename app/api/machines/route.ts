import { NextResponse } from "next/server";
import { matchCode } from "@/lib/link/keys";
import { CAP_UP } from "@/lib/link/protocol";
import { linkHub, machinesOn, ownSha } from "@/lib/link/server";
import { listMachines, serverName } from "@/lib/link/store";
import { copySummary } from "@/lib/backup/views";

export const dynamic = "force-dynamic";

// GET /api/machines - the machines linked to this AgentOS and whether each
// is connected. { enabled: false } when the feature is off.
export async function GET() {
  if (!machinesOn()) {
    return NextResponse.json({ enabled: false, machines: [] });
  }
  const hub = linkHub();
  const sha = ownSha();
  const machines = listMachines();
  const copies = await Promise.all(machines.map((m) => copySummary(m.id)));
  return NextResponse.json(
    {
      enabled: true,
      // What the user calls this server, null when they gave it no name
      serverName: serverName(),
      machines: machines.map((m, i) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        presence: hub.presence(m.id),
        platform: m.platform,
        // Shown beside a waiting machine, to match the code on its screen
        code: m.status === "pending" ? matchCode(m.public_key) : null,
        signedInAs: m.signed_in_as,
        createdAt: m.created_at,
        lastSeen: m.last_seen,
        sameVersion: !sha || !m.sha ? null : m.sha === sha,
        // Sessions on this server may use it (the user's switch)
        agents: m.agents === 1,
        // Its sessions may use this server (the other switch)
        usesHub: m.uses_hub === 1,
        // It can ask this server at all; null while it's offline
        up: hub.hasCap(m.id, CAP_UP),
        // Copies of its sessions kept here (lib/backup), and the switch
        ...copies[i],
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
