import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { launchSession } from "@/lib/session-launch";
import { isPaused } from "@/lib/handoff-types";
import { isSettled } from "@/lib/settle-types";
import { effectiveMode } from "@/lib/permission-mode";
import { grantFullAccess, requester, userOnly } from "@/lib/permission-guard";

// POST /api/sessions/[id]/launch - Start the session's agent in tmux without
// a page attached: { initialPrompt? }. { started: false } if already running.
// With full access, only the user may give it an initialPrompt.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // Handed off (M4): only resume-paused starts it again
  if (isPaused(session)) {
    return NextResponse.json(
      { error: "This session is paused", reason: "paused" },
      { status: 409 }
    );
  }
  // Settled (M8): only Undo (DELETE settle) starts it again
  if (isSettled(session)) {
    return NextResponse.json(
      { error: "This session is settled", reason: "settled" },
      { status: 409 }
    );
  }
  const { initialPrompt } = (await request.json().catch(() => ({}))) as {
    initialPrompt?: string;
  };
  // A task for a session with full access is the user's to give
  // (lib/permission-guard.ts); it starts idle without one
  if (initialPrompt?.trim() && effectiveMode(session) === "bypassPermissions") {
    const who = requester(request);
    const { refuse } = grantFullAccess(request, who, {
      targetSessionId: session.id,
      action: "send_keys",
      detail: initialPrompt.trim(),
    });
    // An agent isn't capped here: there's nothing less to give it
    if (who.by !== "user") return refuse ?? userOnly(who.reason);
  }
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
