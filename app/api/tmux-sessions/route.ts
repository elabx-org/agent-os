import { NextResponse } from "next/server";
import { execSync } from "child_process";

/**
 * GET /api/tmux-sessions
 *
 * Lists active tmux sessions with their metadata.
 */
export async function GET() {
  try {
    const output = execSync(
      "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}' 2>/dev/null || echo ''",
      { encoding: "utf-8", timeout: 5000, shell: "/bin/bash" }
    ).trim();

    if (!output) {
      return NextResponse.json({ sessions: [] });
    }

    const sessions = output
      .split("\n")
      .filter((line) => line.includes("|"))
      .map((line) => {
        const [name, windows, created, attached] = line.split("|");
        return {
          name,
          windows: parseInt(windows),
          created: parseInt(created),
          attached: attached === "1",
        };
      });

    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ sessions: [] });
  }
}
