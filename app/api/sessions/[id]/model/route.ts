import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { HandoffRefused, switchModel } from "@/lib/handoff";
import {
  isClaudeModelAlias,
  isEffortLevel,
  type ModelSwitchResult,
} from "@/lib/handoff-types";

// POST /api/sessions/[id]/model {model, effort?} - ModelSwitchResult.
// The user's only. Claude sessions: `/model <alias>` (and `/effort
// <level>`) go through the queue as commands, sent only at idle; with the
// queue off or the session stopped they apply at its next launch.
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
  const model: unknown = body?.model;
  const effort: unknown = body?.effort ?? undefined;
  if (!isClaudeModelAlias(model)) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }
  if (effort !== undefined && !isEffortLevel(effort)) {
    return NextResponse.json(
      { error: "Unknown effort level" },
      { status: 400 }
    );
  }

  try {
    const result: ModelSwitchResult = await switchModel(session, {
      model,
      effort,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HandoffRefused) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("Model switch failed:", error);
    return NextResponse.json({ error: "Model switch failed" }, { status: 500 });
  }
}
