import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { HandoffRefused, handoff } from "@/lib/handoff";
import { isHandoffAgent, type HandoffResult } from "@/lib/handoff-types";

// POST /api/sessions/[id]/handoff {agentType, model?, permissionMode?} -
// HandoffResult. The user's only, and only between turns (409 busy). A new
// session in the same folder gets this one's summary as its first message;
// then this one is paused and its tmux ended. On failure it is untouched.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const agentType: unknown = body?.agentType;
  const model: unknown = body?.model ?? undefined;
  const permissionMode: unknown = body?.permissionMode ?? undefined;
  if (!isHandoffAgent(agentType)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }
  if (model !== undefined && typeof model !== "string") {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }
  if (permissionMode !== undefined && typeof permissionMode !== "string") {
    return NextResponse.json(
      { error: "Unknown permission mode" },
      { status: 400 }
    );
  }

  try {
    const result: HandoffResult = await handoff(session, {
      agentType,
      model,
      permissionMode,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof HandoffRefused) {
      return NextResponse.json(error.body, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Handoff failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
