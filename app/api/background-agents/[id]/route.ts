import { NextRequest, NextResponse } from "next/server";
import {
  backgroundAgentConversation,
  backgroundAgentLogs,
  isAgentId,
  listBackgroundAgents,
  stopBackgroundAgent,
} from "@/lib/claude-background";

type Params = { params: Promise<{ id: string }> };

// GET /api/background-agents/[id] - the latest of its conversation, or its
// recent terminal output (`claude logs`) before it has a transcript
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isAgentId(id)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }
  try {
    const agent = (await listBackgroundAgents()).find((a) => a.id === id);
    const items = agent ? backgroundAgentConversation(agent) : null;
    if (items) return NextResponse.json({ items });
    return NextResponse.json({ logs: await backgroundAgentLogs(id) });
  } catch (error) {
    const err = error as { stderr?: string };
    const message = err.stderr?.trim() || "";
    // Its job is gone and it left no conversation: nothing to show, which
    // isn't an error to the page
    if (/job not found|already exited/i.test(message))
      return NextResponse.json({ logs: "", ended: true });
    return NextResponse.json(
      { error: message || "No output for it" },
      { status: 404 }
    );
  }
}

// DELETE /api/background-agents/[id] - stop it, keeping the conversation;
// ?remove=1 deletes it and its worktree (`claude rm`)
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isAgentId(id)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }
  const remove = new URL(request.url).searchParams.get("remove") === "1";
  try {
    return NextResponse.json({ output: await stopBackgroundAgent(id, remove) });
  } catch (error) {
    // The CLI explains refusals (unpushed commits in its worktree) on stderr
    const err = error as { stderr?: string; stdout?: string };
    const message = (err.stderr || err.stdout || "").trim();
    return NextResponse.json(
      {
        error: message || (remove ? "Couldn't remove it" : "Couldn't stop it"),
      },
      { status: 409 }
    );
  }
}
