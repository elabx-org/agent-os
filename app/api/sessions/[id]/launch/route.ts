import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { launchSession } from "@/lib/session-launch";

// POST /api/sessions/[id]/launch - Start the session's agent in tmux without
// a page attached: { initialPrompt? }. { started: false } if already running.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const { initialPrompt } = (await request.json().catch(() => ({}))) as {
    initialPrompt?: string;
  };
  try {
    const started = await launchSession(
      session,
      initialPrompt?.trim() || undefined
    );
    return NextResponse.json({ started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
