import { NextResponse } from "next/server";
import { hubUp, isMachineMode } from "@/lib/link/machine";

export const dynamic = "force-dynamic";

// GET /api/hub - on a linked machine: whether it can ask its server and
// what the server lets its sessions do. { linked: false } on a server
export async function GET() {
  if (!isMachineMode()) {
    return NextResponse.json(
      { linked: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(hubUp(), {
    headers: { "Cache-Control": "no-store" },
  });
}
