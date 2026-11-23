import { NextResponse } from "next/server";
import { ownerRead } from "@/lib/backup/owner";
import { placeView } from "@/lib/backup/place";
import { isMachineMode } from "@/lib/link/machine";

export const dynamic = "force-dynamic";

const ID = /^[\w-]{1,100}$/;
const MACHINE = /^m_[0-9a-f]{12}$/;

// GET /api/machines/place?ids=a,b[&on=m_...] - PlaceView: where the copies
// of these sessions are and how fresh. `on` names the machine they live
// on; without it they live on this server. The user's page only
export async function GET(request: Request) {
  const no = ownerRead(request);
  if (no) return no;
  // A linked machine doesn't know the whole picture: its server does
  if (isMachineMode()) {
    return NextResponse.json({ here: "", places: {} });
  }
  const url = new URL(request.url);
  const on = url.searchParams.get("on");
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => ID.test(id))
    .slice(0, 200);
  if (on !== null && !MACHINE.test(on)) {
    return NextResponse.json({ error: "Which machine?" }, { status: 400 });
  }
  return NextResponse.json(placeView(on, ids), {
    headers: { "Cache-Control": "no-store" },
  });
}
