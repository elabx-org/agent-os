import { NextResponse } from "next/server";
import { listMachineActions } from "@/lib/link/machine-actions";
import { machinesOn } from "@/lib/link/server";
import { isUserPageRequest } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/machines/[id]/activity?limit=50 - what that machine's sessions
// did here, newest first. Only for the user's own page
export async function GET(request: Request, { params }: Context) {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  if (!isUserPageRequest(request)) {
    return NextResponse.json({ error: "user_only" }, { status: 403 });
  }
  const { id } = await params;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return NextResponse.json(
    {
      actions: listMachineActions(
        id,
        Number.isInteger(limit) && limit > 0 ? limit : 50
      ),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
