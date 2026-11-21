import { NextResponse } from "next/server";
import { linkHub, machinesOn } from "@/lib/link/server";
import { listMachines, serverName } from "@/lib/link/store";

export const dynamic = "force-dynamic";

// GET /api/link/peers - this server and the machines linked to it, as a
// session on one of them may see them: no codes, no sign-in names, only
// approved machines
export async function GET() {
  const machines = machinesOn()
    ? listMachines()
        .filter((m) => m.status === "approved")
        .map((m) => ({
          id: m.id,
          name: m.name,
          platform: m.platform,
          online: linkHub().presence(m.id) === "online",
          // The user lets this server's sessions use it
          usableByServerSessions: m.agents === 1,
        }))
    : [];
  return NextResponse.json(
    { serverName: serverName(), machines },
    { headers: { "Cache-Control": "no-store" } }
  );
}
