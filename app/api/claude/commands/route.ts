import { NextRequest, NextResponse } from "next/server";
import { listClaudeCommands } from "@/lib/claude-commands";
import { expandPath } from "@/lib/git-status";

/**
 * GET /api/claude/commands?cwd=...
 * Claude Code's "/" commands, grouped by where they come from
 */
export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd");
  try {
    return NextResponse.json(listClaudeCommands(cwd ? expandPath(cwd) : null));
  } catch (error) {
    console.error("Error listing Claude commands:", error);
    return NextResponse.json(
      { error: "Failed to list commands" },
      { status: 500 }
    );
  }
}
