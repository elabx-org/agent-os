import { NextResponse } from "next/server";
import { matchCode } from "@/lib/link/keys";
import { linkHub, machinesOn, ownSha } from "@/lib/link/server";
import { listMachines, serverName } from "@/lib/link/store";

export const dynamic = "force-dynamic";

// GET /api/machines - the machines linked to this AgentOS and whether each
// is connected. { enabled: false } when the feature is off.
export async function GET() {
  if (!machinesOn()) {
    return NextResponse.json({ enabled: false, machines: [] });
  }
  const hub = linkHub();
  const sha = ownSha();
  return NextResponse.json(
    {
      enabled: true,
      // What the user calls this server, null when they gave it no name
      serverName: serverName(),
      machines: listMachines().map((m) => ({
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
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
