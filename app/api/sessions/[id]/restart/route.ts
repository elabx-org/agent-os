import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import { readClaudeSessionMeta } from "@/lib/claude-transcript";

const execFileAsync = promisify(execFile);

// POST /api/sessions/[id]/restart - end a Claude session's tmux so the next
// attach starts it again, resuming the same conversation with its stored
// permission mode (which applies a pending full access). Refuses when the
// conversation to resume can't be found.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.agent_type !== "claude") {
    return NextResponse.json(
      { error: "Only Claude sessions can be restarted" },
      { status: 400 }
    );
  }
  const target = session.tmux_name || `claude-${id}`;

  // The running conversation, not the newest transcript in the folder
  const meta = await readClaudeSessionMeta(target);
  const claudeSessionId = meta?.sessionId || session.claude_session_id;
  if (!claudeSessionId) {
    return NextResponse.json(
      { error: "Couldn't find this session's conversation to resume" },
      { status: 409 }
    );
  }
  if (claudeSessionId !== session.claude_session_id) {
    db.prepare(
      "UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(claudeSessionId, id);
  }

  // The relaunch takes permission_mode; its caps are recorded anew
  queries.clearSessionPermissionPending(db).run(id);

  try {
    await execFileAsync("tmux", ["kill-session", "-t", target]);
  } catch {
    // Not running: the next attach starts it anyway
  }
  return NextResponse.json({
    session: queries.getSession(db).get(id) as Session,
  });
}
