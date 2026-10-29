import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { randomUUID } from "crypto";
import {
  announceFullAccess,
  grantFullAccess,
  requester,
} from "@/lib/permission-guard";
import { capForAgent, effectiveMode, flagsFor } from "@/lib/permission-mode";
import { buildSummary } from "@/lib/summarize";
import { sessionCwd } from "@/lib/transcript-locate";
import { tmuxNameOf } from "@/lib/session-launch";
import { sendText } from "@/lib/tmux-send";

const execFileAsync = promisify(execFile);

// The folder the pane is in now (the agent may have moved), else the session's
async function getTmuxCwd(tmuxName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "display-message",
      "-t",
      `=${tmuxName}:`,
      "-p",
      "#{pane_current_path}",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Wait for Claude prompt to appear in tmux session
async function waitForClaudeReady(
  tmuxName: string,
  maxAttempts = 30
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t",
        `=${tmuxName}:`,
        "-p",
      ]);
      // Look for Claude's status line which appears when UI is ready
      if (stdout.includes("⏵⏵") || stdout.includes("accept edits")) {
        return true;
      }
    } catch {
      // Ignore errors, keep polling
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// POST /api/sessions/[id]/summarize - Summarize and create fresh session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { createFork = true, sendContext = true } = body;

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Full access carries over to the fresh session for the user only; an
    // agent's gets the capped mode (lib/permission-guard.ts). Checked before
    // the summary is made, so a refusal costs nothing
    const newId = randomUUID();
    let mode = effectiveMode(session);
    if (createFork && mode === "bypassPermissions") {
      const { grant, refuse } = grantFullAccess(request, requester(request), {
        targetSessionId: session.id,
        action: "summarize",
        detail: "Full access not carried over to the fresh session",
      });
      if (refuse) return refuse;
      if (!grant) mode = capForAgent(mode);
    }
    // NULL without auto-approve stays NULL: no flag, the agent's own default
    const newMode =
      session.permission_mode || session.auto_approve ? mode : null;
    const autoApprove = mode === "bypassPermissions";

    // The pane's folder, else the session's (worktree first, ~ expanded)
    const cwd = (await getTmuxCwd(tmuxNameOf(session))) || sessionCwd(session);

    // The transcript (found without a pane too, under CLAUDE_CONFIG_DIR),
    // else the pane's scrollback; condensed with `claude -p`. Never throws:
    // with neither, it still carries the folder, files changed and plan
    const { text: summary } = await buildSummary(session, { useModel: true });

    // Create a new session with the summary as context
    let newSession: Session | null = null;
    if (createFork) {
      const newName = `${session.name} (fresh)`;
      const agentType = session.agent_type || "claude";
      const tmuxName = `${agentType}-${newId}`;

      // Create new session in DB (using cwd already fetched above)
      queries.createSession(db).run(
        newId,
        newName,
        tmuxName,
        cwd,
        null, // no parent - fresh start
        session.model,
        summary,
        session.group_path,
        agentType,
        autoApprove ? 1 : 0,
        0,
        session.project_id || "uncategorized"
      );

      if (newMode) {
        queries
          .updateSessionPermissionMode(db)
          .run(newMode, null, autoApprove ? 1 : 0, newId);
      }

      newSession = queries.getSession(db).get(newId) as Session;
      if (autoApprove) announceFullAccess(newSession);
      const newTmuxSession = tmuxName;

      // Start new tmux session with Claude directly
      const claudeCmd = ["claude", ...flagsFor("claude", newMode)].join(" ");

      await execFileAsync("tmux", [
        "new-session",
        "-d",
        "-s",
        newTmuxSession,
        "-c",
        cwd,
        claudeCmd,
      ]);
      console.log(`[summarize] Tmux session created: ${newTmuxSession}`);

      // Give Claude a moment to start up before polling
      await new Promise((r) => setTimeout(r, 2000));

      // Wait for Claude to be ready and send context
      if (sendContext) {
        console.log(`[summarize] Waiting for Claude to be ready...`);
        const ready = await waitForClaudeReady(newTmuxSession);
        console.log(`[summarize] Claude ready: ${ready}`);
        if (ready) {
          const contextMessage = `${summary}\n\nPlease acknowledge you've received this context and are ready to continue.`;
          console.log(
            `[summarize] Sending context message (${contextMessage.length} chars)`
          );
          await sendText(newSession, contextMessage);
          console.log(`[summarize] Context sent!`);
        } else {
          console.log(
            `[summarize] WARNING: Claude not ready, skipping context send`
          );
        }
      }
    }

    return NextResponse.json({
      summary,
      newSession,
    });
  } catch (error) {
    console.error("Error summarizing session:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
