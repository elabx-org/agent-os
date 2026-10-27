import { NextRequest, NextResponse } from "next/server";
import { writeInitScript } from "@/lib/init-script";

// POST /api/sessions/init-script - Create init script and return path
export async function POST(request: NextRequest) {
  try {
    const { agentCommand } = await request.json();

    if (!agentCommand) {
      return NextResponse.json(
        { error: "agentCommand is required" },
        { status: 400 }
      );
    }

    const command = writeInitScript(agentCommand);
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
