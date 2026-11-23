import { NextResponse } from "next/server";
import { setAbilityNotes } from "@/lib/abilities";
import { cleanNotes } from "@/lib/abilities-types";
import { abilitiesView, swapAbilities } from "@/lib/abilities-view";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

// GET /api/abilities[?fresh=1] - AbilitiesView: what this machine can do
// (Xcode, Docker…), the user's note about it, and the machines linked
// with it. `fresh` checks again now
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const view = await abilitiesView(fresh);
  // A linked machine's server hears of what changed
  if (fresh) void swapAbilities().catch(() => {});
  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}

// PUT /api/abilities { notes } - the user's note about this machine, told
// to every session that starts on it. The user's page only
export async function PUT(request: Request) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as { notes?: unknown };
  const notes = cleanNotes(body.notes);
  if (notes === null) {
    return NextResponse.json({ error: "What note?" }, { status: 400 });
  }
  setAbilityNotes(notes);
  return NextResponse.json({ notes });
}
