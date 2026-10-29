import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import type { PermissionPrompt } from "@/lib/permission-prompt";
import {
  agentMayAnswer,
  isAgentOrigin,
  PERMISSION_USER_ONLY,
  readScreenPrompt as readPrompt,
} from "@/lib/agent-origin";
import { agentActor, recordAgentAction } from "@/lib/agent-actions";
import { requireUser } from "@/lib/user-proof";

const execFileAsync = promisify(execFile);

function getSession(id: string): Session | null {
  return (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;
}

function tmuxName(session: Session): string {
  return session.tmux_name || `${session.agent_type || "claude"}-${session.id}`;
}

// GET /api/sessions/[id]/prompt - The selection prompt Claude Code is showing, if any
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const target = tmuxName(session);
  try {
    return NextResponse.json({ prompt: await readPrompt(target) });
  } catch {
    // tmux session not running
    return NextResponse.json({ prompt: null });
  }
}

// POST /api/sessions/[id]/prompt - Answer it: { index, label }
// The label must still match, so a stale tap can't answer a different prompt.
// Without proof that it's the user (lib/user-proof.ts), including every
// request from an agent (x-agentos-origin: agent), only a question can be
// answered: permission requests are the user's. Agents' answers and refused
// attempts go to agent_actions, for the permission card.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { index, label } = (await request.json()) as {
    index?: number;
    label?: string;
  };
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const target = tmuxName(session);

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

  const fromAgent = isAgentOrigin(request);
  const proof = requireUser(request);
  if (!proof.ok) {
    const audit = {
      actorTmux: agentActor(request),
      targetSessionId: session.id,
      action: "prompt_answer" as const,
      detail: label,
    };
    // Classified as the Needs you card does; can't tell means permission
    if (!(await agentMayAnswer(session, prompt))) {
      // no_proof is the user's own tab with a cookie from before a restart:
      // the client re-proves and retries, so it isn't an agent's attempt
      if (proof.reason !== "no_proof") {
        recordAgentAction({ ...audit, allowed: false });
      }
      return NextResponse.json(
        { error: PERMISSION_USER_ONLY, permission: true, reason: proof.reason },
        { status: 403 }
      );
    }
    if (fromAgent) recordAgentAction({ ...audit, allowed: true });
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
