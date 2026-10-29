import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import { readClaudeState } from "@/lib/claude-state";
import { readClaudeScreen } from "@/lib/claude-screen";
import { readScreenPrompt } from "@/lib/agent-origin";
import { forgetRetried, recordRefusal } from "@/lib/agent-actions";
import { effectiveMode, isEscalation } from "@/lib/permission-mode";
import { readLiveMode } from "@/lib/permission-mode-live";
import { userOnly } from "@/lib/permission-guard";
import { requireUser } from "@/lib/user-proof";
import { restartWithStoredMode } from "@/lib/apply-pending-mode";

const execFileAsync = promisify(execFile);

/**
 * Claude is mid-turn on screen: its spinner, or a prompt it waits on.
 * True when the screen can't be read.
 */
async function midTurn(target: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane",
      "-t",
      target,
      "-p",
    ]);
    if (readClaudeScreen(stdout.split("\n")).spinner) return true;
    return (await readScreenPrompt(target)) !== null;
  } catch {
    return true;
  }
}

// POST /api/sessions/[id]/restart - end a Claude session's tmux so the next
// attach starts it again, resuming the same conversation with its stored
// permission mode (which applies a pending full access). Refuses when the
// conversation to resume can't be found. {whenIdle: true} refuses (409)
// while Claude is mid-turn, so a pending full access never cuts one short.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.agent_type !== "claude") {
    return NextResponse.json(
      { error: "Only Claude sessions can be restarted" },
      { status: 400 }
    );
  }
  const target = session.tmux_name || `claude-${id}`;
  const { whenIdle } = await request.json().catch(() => ({}));
  // The relaunch takes the stored mode: when that's more than the session
  // runs with now (a pending full access, or the user Shift+Tabbed down),
  // restarting raises it, which is the user's call
  const live = await readLiveMode(session);
  if (
    session.permission_pending ||
    isEscalation(effectiveMode(session), live ?? "manual")
  ) {
    const proof = requireUser(request);
    if (!proof.ok) {
      recordRefusal(request, {
        targetSessionId: id,
        action: "permission_mode",
        detail: "Restart with full access",
      });
      return userOnly(proof.reason);
    }
    forgetRetried(id, "permission_mode");
  }
  // busy stays set after an Esc until Claude's idle notice (no Stop hook
  // on an interrupt), so the screen has the last word
  if (
    whenIdle === true &&
    readClaudeState(id).busy &&
    (await midTurn(target))
  ) {
    return NextResponse.json(
      { error: "Claude is busy. Restart it when this turn ends", busy: true },
      { status: 409 }
    );
  }

  const restarted = await restartWithStoredMode(session);
  if (!restarted.ok) {
    return NextResponse.json({ error: restarted.error }, { status: 409 });
  }
  return NextResponse.json({ session: restarted.session });
}
