import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { isRunning, tmuxNameOf } from "@/lib/session-launch";
import { fromMachine } from "@/lib/link/from-machine";
import { fromMachineRefusal, isClaudeSession } from "@/lib/from-machine-rules";

const execFileAsync = promisify(execFile);

// POST /api/sessions/[id]/stop - End the session's tmux (and its agent);
// the session stays, and opening it starts it again
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (fromMachine(request) && !isClaudeSession(session)) {
    return fromMachineRefusal("claude_only");
  }
  if (!(await isRunning(session))) {
    return NextResponse.json({ stopped: false });
  }
  await execFileAsync("tmux", [
    "kill-session",
    "-t",
    `=${tmuxNameOf(session)}`,
  ]);
  return NextResponse.json({ stopped: true });
}
