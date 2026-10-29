import { NextResponse } from "next/server";

// POST /api/sessions/[id]/settle {force?} - SettleResult; DELETE - unsettle,
// UnsettleResult (M8, lib/settle.ts; types in lib/settle-types.ts).
// User-only (requireUser); 409 SettleError {reason} when refused
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
