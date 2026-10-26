import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import { readClaudeScreen } from "@/lib/claude-screen";

const execFileAsync = promisify(execFile);

// GET /api/sessions/[id]/screen - What Claude Code shows at the bottom of
// its pane (mode, spinner, queued messages), for views without a terminal
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session || session.agent_type !== "claude") {
    return NextResponse.json({ screen: null });
  }
  const target = session.tmux_name || `claude-${id}`;
  try {
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane",
      "-t",
      target,
      "-p",
    ]);
    return NextResponse.json({ screen: readClaudeScreen(stdout.split("\n")) });
  } catch {
    return NextResponse.json({ screen: null });
  }
}
