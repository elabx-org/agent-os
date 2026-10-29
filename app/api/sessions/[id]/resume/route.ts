import { NextResponse } from "next/server";

// POST /api/sessions/[id]/resume {when: 'reset'|'now'|'snooze', text?} -
// ResumeResult (lib/limits/types.ts). M6 U6.2
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

// DELETE /api/sessions/[id]/resume - ResumeResult: cancels a scheduled
// resume or a snooze. M6 U6.2
export async function DELETE() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
