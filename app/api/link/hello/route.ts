import { NextResponse } from "next/server";
import { fromMachine } from "@/lib/link/from-machine";
import { machineById, serverName } from "@/lib/link/store";

export const dynamic = "force-dynamic";

// GET /api/link/hello - what a session on a linked machine sees when it
// first reaches this server: the server's name, and which machine it
// came from (null when it was asked here)
export async function GET(request: Request) {
  const from = fromMachine(request);
  const machineId = from && from !== "hub" ? from : null;
  return NextResponse.json(
    {
      serverName: serverName(),
      machineId,
      name: machineId ? (machineById(machineId)?.name ?? null) : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
