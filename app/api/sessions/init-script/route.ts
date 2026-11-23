import { NextRequest, NextResponse } from "next/server";
import { writeInitScript, writeShellScript } from "@/lib/init-script";

// POST /api/sessions/init-script { agentCommand, cwd } - writes the script
// tmux runs for a session and returns the command; { shell: true, cwd }
// writes the one for a shell session
export async function POST(request: NextRequest) {
  try {
    const { agentCommand, cwd, shell } = await request.json();

    // A shell session: the login shell, in its folder
    if (shell === true && typeof cwd === "string" && cwd) {
      return NextResponse.json({ command: writeShellScript(cwd) });
    }

    if (!agentCommand) {
      return NextResponse.json(
        { error: "agentCommand is required" },
        { status: 400 }
      );
    }

    // `cwd`: the session's folder, which the script goes into itself
    const command = writeInitScript(
      agentCommand,
      typeof cwd === "string" && cwd ? cwd : undefined
    );
    return NextResponse.json({
      scriptPath: command.slice("bash ".length),
      command,
    });
  } catch (error) {
    console.error("Error creating init script:", error);
    return NextResponse.json(
      { error: "Failed to create init script" },
      { status: 500 }
    );
  }
}
