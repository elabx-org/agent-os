import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { tmuxNameOf } from "@/lib/session-launch";
import {
  cachedBackgroundAgents,
  stopBackgroundAgent,
} from "@/lib/claude-background";

const execFileAsync = promisify(execFile);

// POST /api/sessions/[id]/bring-back - A session Claude moved to its
// background agents comes back to its own terminal: the job stops (its
// conversation is kept) and the session's tmux ends, so the page's next
// attach resumes the conversation there (lib/init-script.ts doesn't attach
// a stopped job). Refuses (409) while the job is mid-turn, which stopping
// would cut short.
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
  const agent = (await cachedBackgroundAgents(0)).find(
    (a) => a.agentOsSessionId === id && a.state !== "stopped"
  );
  if (!agent) {
    return NextResponse.json(
      { error: "This session isn't in the background" },
      { status: 404 }
    );
  }
  if (agent.state === "working") {
    return NextResponse.json(
      { error: "It's working. Bring it back when this turn ends", busy: true },
      { status: 409 }
    );
  }
  try {
    await stopBackgroundAgent(agent.id, false);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Couldn't stop the agent",
      },
      { status: 500 }
    );
  }
  // The resume takes this conversation, whichever pane parked it
  if (agent.sessionId && agent.sessionId !== session.claude_session_id) {
    db.prepare(
      "UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(agent.sessionId, id);
  }
  try {
    await execFileAsync("tmux", [
      "kill-session",
      "-t",
      `=${tmuxNameOf(session)}`,
    ]);
  } catch {
    // Not running: the next attach starts it anyway
  }
  return NextResponse.json({
    session: queries.getSession(db).get(id) as Session,
  });
}
