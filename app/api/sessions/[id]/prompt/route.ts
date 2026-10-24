import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import {
  parsePermissionPrompt,
  type PermissionPrompt,
} from "@/lib/permission-prompt";

const execFileAsync = promisify(execFile);

function tmuxName(id: string): string | null {
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) return null;
  return session.tmux_name || `${session.agent_type || "claude"}-${id}`;
}

async function readPrompt(target: string): Promise<PermissionPrompt | null> {
  const [{ stdout: pane }, { stdout: width }] = await Promise.all([
    execFileAsync("tmux", ["capture-pane", "-t", target, "-p"]),
    execFileAsync("tmux", [
      "display-message",
      "-t",
      target,
      "-p",
      "#{pane_width}",
    ]),
  ]);
  return parsePermissionPrompt(pane.split("\n"), Number(width) || 80);
}

// GET /api/sessions/[id]/prompt - The selection prompt Claude Code is showing, if any
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const target = tmuxName(id);
  if (!target) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    return NextResponse.json({ prompt: await readPrompt(target) });
  } catch {
    // tmux session not running
    return NextResponse.json({ prompt: null });
  }
}

// POST /api/sessions/[id]/prompt - Answer it: { index, label }
// The label must still match, so a stale tap can't answer a different prompt
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { index, label } = (await request.json()) as {
    index?: number;
    label?: string;
  };
  const target = tmuxName(id);
  if (!target) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let prompt: PermissionPrompt | null;
  try {
    prompt = await readPrompt(target);
  } catch {
    return NextResponse.json({ error: "Session not running" }, { status: 409 });
  }
  const option = prompt?.options[index ?? -1];
  if (!prompt || !option || option.label !== label) {
    return NextResponse.json(
      { error: "The prompt changed; check the session", prompt },
      { status: 409 }
    );
  }

  // Move the ❯ cursor to the option, then confirm. Works for numbered and
  // unnumbered menus alike.
  const delta = option.index - prompt.selected;
  const moves = Array(Math.abs(delta)).fill(delta > 0 ? "Down" : "Up");
  if (moves.length) {
    await execFileAsync("tmux", ["send-keys", "-t", target, ...moves]);
    await new Promise((r) => setTimeout(r, 150));
  }
  await execFileAsync("tmux", ["send-keys", "-t", target, "Enter"]);

  return NextResponse.json({ success: true });
}
