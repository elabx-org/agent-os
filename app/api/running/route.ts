import { NextResponse } from "next/server";
import { listRunning } from "@/lib/running";

export const dynamic = "force-dynamic";

// GET /api/running - servers listening in the container, each with the
// session that started it and its proxy link (M16)
export async function GET() {
  try {
    return NextResponse.json({ servers: await listRunning() });
  } catch (error) {
    console.error("Error listing running servers:", error);
    return NextResponse.json(
      { error: "Couldn't list what's running" },
      { status: 500 }
    );
  }
}
