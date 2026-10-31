import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { EMPTY_CLAUDE_STATE, readClaudeState } from "@/lib/claude-state";
import { findTranscript } from "@/lib/claude-transcript";
import { lastTranscriptModel, modelNameFromId } from "@/lib/transcript-model";

// GET /api/sessions/[id]/claude-state - what the session's Claude last
// recorded through its hooks and status line: mode, busy, current tool,
// pending permission, model/context/cost. Null fields until it has run
// with them (sessions started before this get them after a restart).
// Without a status line model, the model its transcript last answered with.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session || session.agent_type !== "claude") {
    return NextResponse.json(EMPTY_CLAUDE_STATE);
  }
  const state = readClaudeState(id);
  if (state.status?.model) return NextResponse.json(state);
  const found = await findTranscript(session.tmux_name || `claude-${id}`);
  const model = found?.file ? lastTranscriptModel(found.file) : null;
  return NextResponse.json({
    ...state,
    transcriptModel: model
      ? { id: model, display_name: modelNameFromId(model) }
      : null,
  });
}
