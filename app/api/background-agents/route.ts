import { NextRequest, NextResponse } from "next/server";
import { validateWorkingDirectory } from "@/lib/projects";
import { getDb } from "@/lib/db";
import {
  listBackgroundAgents,
  parkedJobPanes,
  startBackgroundAgent,
} from "@/lib/claude-background";

// GET /api/background-agents - Claude Code's background agents, newest first
export async function GET() {
  try {
    const [agents, parked] = await Promise.all([
      listBackgroundAgents(),
      parkedJobPanes(),
    ]);
    // A session sent to the background is still that Agent-OS session
    const byTmux = new Map(
      (
        getDb()
          .prepare(
            "SELECT id, tmux_name FROM sessions WHERE tmux_name IS NOT NULL"
          )
          .all() as { id: string; tmux_name: string }[]
      ).map((s) => [s.tmux_name, s.id])
    );
    for (const agent of agents) {
      const pane = parked.get(agent.id);
      const sessionId = pane ? byTmux.get(pane) : undefined;
      if (sessionId) agent.agentOsSessionId = sessionId;
    }
    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error listing background agents:", error);
    return NextResponse.json({ agents: [], error: "Couldn't list them" });
  }
}

// POST /api/background-agents - start one: { cwd, prompt, model? }
export async function POST(request: NextRequest) {
  const { cwd, prompt, model } = await request.json();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "A task is required" }, { status: 400 });
  }
  if (typeof cwd !== "string" || !validateWorkingDirectory(cwd)) {
    return NextResponse.json(
      { error: "That folder doesn't exist" },
      { status: 400 }
    );
  }
  if (model !== undefined && !/^[\w.-]+$/.test(model)) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }
  try {
    const output = await startBackgroundAgent({
      cwd: cwd.replace(/^~/, process.env.HOME || "~"),
      prompt: prompt.trim(),
      model: model || undefined,
    });
    return NextResponse.json({ output });
  } catch (error) {
    // Claude Code says why on stderr, e.g. a folder that isn't trusted yet
    const err = error as { stderr?: string };
    console.error("Error starting background agent:", error);
    return NextResponse.json(
      { error: err.stderr?.trim() || "Claude Code couldn't start it" },
      { status: 500 }
    );
  }
}
