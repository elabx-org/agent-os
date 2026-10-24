import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";

const execFileAsync = promisify(execFile);

// POST /api/sessions/[id]/interrupt - Esc, which stops Claude Code mid-turn
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const target = session.tmux_name || `${session.agent_type || "claude"}-${id}`;
  try {
    await execFileAsync("tmux", ["send-keys", "-t", target, "Escape"]);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Tmux session not running" },
      { status: 400 }
    );
  }
}
