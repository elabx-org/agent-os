import { NextResponse } from "next/server";
import { spawnWorker } from "@/lib/orchestration";
import { isAgentOrigin } from "@/lib/agent-origin";
import { agentActor, recordAgentAction } from "@/lib/agent-actions";
import { requireUser } from "@/lib/user-proof";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      conductorSessionId,
      task,
      workingDirectory,
      branchName,
      useWorktree = true,
      model = "sonnet",
      agentType = "claude",
    } = body;

    if (!conductorSessionId || !task || !workingDirectory) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: conductorSessionId, task, workingDirectory",
        },
        { status: 400 }
      );
    }

    // Only the user's workers skip permission prompts (see spawnWorker)
    const fromUser = requireUser(request).ok;
    const session = await spawnWorker({
      conductorSessionId,
      task,
      workingDirectory,
      branchName,
      useWorktree,
      model,
      agentType,
      fromUser,
    });
    if (isAgentOrigin(request)) {
      recordAgentAction({
        actorTmux: agentActor(request),
        actorSessionId: conductorSessionId,
        targetSessionId: session.id,
        action: "spawn",
        allowed: true,
        detail: session.permission_mode,
      });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Failed to spawn worker:", error);
    return NextResponse.json(
      { error: "Failed to spawn worker" },
      { status: 500 }
    );
  }
}
