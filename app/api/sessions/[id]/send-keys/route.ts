import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { appendFileSync } from "fs";
import {
  agentMayAnswer,
  PERMISSION_USER_ONLY,
  readScreenPrompt,
} from "@/lib/agent-origin";
import {
  agentActor,
  agentActorSessionId,
  forgetRetried,
  recordAgentAction,
  recordRefusal,
} from "@/lib/agent-actions";
import { requester } from "@/lib/permission-guard";
import { effectiveMode } from "@/lib/permission-mode";

const execAsync = promisify(exec);

// Log to file for debugging
const LOG_FILE = "/tmp/agent-os-send-keys.log";
function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(`[send-keys] ${msg}`);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

// POST /api/sessions/[id]/send-keys - Send text to a tmux session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { text, pressEnter = true } = body;

    log(`=== START send-keys for session ${id} ===`);
    log(`Text length: ${text?.length || 0}, pressEnter: ${pressEnter}`);

    if (!text) {
      log("ERROR: No text provided");
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      log(`ERROR: Session ${id} not found in DB`);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const tmuxSessionName = `${session.agent_type}-${id}`;
    log(`Tmux session name: ${tmuxSessionName}`);

    // Check if tmux session exists
    try {
      await execAsync(`tmux has-session -t "${tmuxSessionName}" 2>/dev/null`);
      log(`Tmux session exists`);
    } catch {
      log(`ERROR: Tmux session ${tmuxSessionName} not running`);
      return NextResponse.json(
        { error: "Tmux session not running" },
        { status: 400 }
      );
    }

    // Typing into a permission dialog would pick an option: without proof
    // that it's the user, only a question's prompt (or none) may be typed
    // into. Nor may an agent hand a task to a session with full access
    // unless its own session has it too (full access by proxy)
    const who = requester(request);
    if (who.by !== "user") {
      const audit = {
        targetSessionId: session.id,
        action: "send_keys" as const,
        detail: text.slice(0, 200),
      };
      const prompt = await readScreenPrompt(tmuxSessionName).catch(() => null);
      if (prompt && !(await agentMayAnswer(session, prompt))) {
        log("REFUSED: message at a permission prompt without user proof");
        recordRefusal(request, audit);
        return NextResponse.json(
          { error: PERMISSION_USER_ONLY, permission: true, reason: who.reason },
          { status: 403 }
        );
      }
      if (!prompt && effectiveMode(session) === "bypassPermissions") {
        const actorId = agentActorSessionId(request, db);
        const actor = actorId
          ? (queries.getSession(db).get(actorId) as Session | undefined)
          : undefined;
        if (!actor || effectiveMode(actor) !== "bypassPermissions") {
          log("REFUSED: task for a full-access session from outside it");
          recordRefusal(request, audit);
          return NextResponse.json(
            {
              error:
                "This session has full access: only the user, or a session with full access, can give it work.",
              reason: who.reason,
            },
            { status: 403 }
          );
        }
      }
      // Typing at a question answers it: shown as "Answered by" on the card
      if (prompt && who.by === "agent") {
        recordAgentAction({
          ...audit,
          actorTmux: agentActor(request),
          allowed: true,
        });
      }
    } else {
      forgetRetried(session.id, "send_keys");
    }

    // Write text to a temp file
    const tempFile = `/tmp/agent-os-send-${id}.txt`;
    const fs = await import("fs/promises");
    await fs.writeFile(tempFile, text);
    log(`Wrote ${text.length} bytes to ${tempFile}`);

    // Use a named buffer to avoid race conditions
    const bufferName = `send-${id}`;

    try {
      // Load file into named tmux buffer
      log(`Loading buffer "${bufferName}" from ${tempFile}`);
      const loadCmd = `tmux load-buffer -b "${bufferName}" "${tempFile}"`;
      log(`Running: ${loadCmd}`);
      const loadResult = await execAsync(loadCmd);
      log(
        `Load stdout: "${loadResult.stdout}", stderr: "${loadResult.stderr}"`
      );

      // Paste the named buffer to the session
      log(`Pasting buffer "${bufferName}" to ${tmuxSessionName}`);
      const pasteCmd = `tmux paste-buffer -b "${bufferName}" -t "${tmuxSessionName}"`;
      log(`Running: ${pasteCmd}`);
      const pasteResult = await execAsync(pasteCmd);
      log(
        `Paste stdout: "${pasteResult.stdout}", stderr: "${pasteResult.stderr}"`
      );

      // Delete the buffer after use
      await execAsync(`tmux delete-buffer -b "${bufferName}"`).catch(() => {});

      // Send Enter if requested
      if (pressEnter) {
        log(`Sending Enter to ${tmuxSessionName}`);
        const enterCmd = `tmux send-keys -t "${tmuxSessionName}" Enter`;
        log(`Running: ${enterCmd}`);
        const enterResult = await execAsync(enterCmd);
        log(
          `Enter stdout: "${enterResult.stdout}", stderr: "${enterResult.stderr}"`
        );
      }

      log(`=== SUCCESS ===`);
      return NextResponse.json({ success: true });
    } catch (cmdError) {
      const msg =
        cmdError instanceof Error ? cmdError.message : String(cmdError);
      log(`ERROR in commands: ${msg}`);
      throw cmdError;
    } finally {
      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {});
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${msg}`);
    console.error("Error sending keys:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
