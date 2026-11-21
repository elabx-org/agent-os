import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";

const execFileAsync = promisify(execFile);

// Get terminal preview (last N lines) from tmux session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    // Only a session we have: the tmux name never comes from the URL
    const session = queries.getSession(db).get(id) as Session | undefined;
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sessionName =
      session.tmux_name || `${session.agent_type || "claude"}-${session.id}`;

    // Capture visible pane content plus scrollback, take last 50 lines
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t",
        sessionName,
        "-p",
        "-S",
        "-100",
      ]));
    } catch {
      // Not running
    }

    // Take the last 50 non-empty lines (trim trailing empty lines)
    const allLines = stdout.split("\n");
    let lastNonEmpty = allLines.length - 1;
    while (lastNonEmpty > 0 && allLines[lastNonEmpty].trim() === "") {
      lastNonEmpty--;
    }
    const lines = allLines.slice(
      Math.max(0, lastNonEmpty - 49),
      lastNonEmpty + 1
    );

    return NextResponse.json({ lines });
  } catch (error) {
    console.error("Error getting session preview:", error);
    return NextResponse.json({ lines: [] });
  }
}
