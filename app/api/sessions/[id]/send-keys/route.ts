import { NextRequest, NextResponse } from "next/server";
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
import { isRunning, tmuxNameOf } from "@/lib/session-launch";
import { sendText } from "@/lib/tmux-send";
import { takesNotice } from "@/lib/queue/types";
import {
  getUndoNotice,
  setUndoNotice,
  takeUndoNotice,
} from "@/lib/queue/store";
import {
  composeOutgoing,
  parseSessionRefs,
  resolveAttachmentBlock,
} from "@/lib/session-attach";
import { quoteAttachMarkers } from "@/lib/session-attach-types";

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
    // Sessions attached with @ (M9), when the queue flag is off
    const refs = parseSessionRefs(body.sessions);
    if (typeof refs === "string") {
      return NextResponse.json({ error: refs }, { status: 400 });
    }

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      log(`ERROR: Session ${id} not found in DB`);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const tmuxSessionName = tmuxNameOf(session);
    log(`Tmux session name: ${tmuxSessionName}`);

    // Check if tmux session exists
    if (await isRunning(session)) {
      log(`Tmux session exists`);
    } else {
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

    // A pending undo notice and the attached sessions' block ride on the
    // next message (lib/turns.ts), not on an answer typed at a prompt or a
    // slash command
    const message =
      pressEnter && typeof text === "string" ? quoteAttachMarkers(text) : text;
    const prefixable =
      pressEnter &&
      takesNotice(message) &&
      (!!getUndoNotice(session.id) || refs.length > 0) &&
      !(await readScreenPrompt(tmuxSessionName).catch(() => null));
    // Attached sessions can't ride on an answer or a command: say so, so
    // the composer keeps the draft and the chips
    if (refs.length > 0 && !prefixable) {
      log("REFUSED: attached sessions on an answer or a command");
      return NextResponse.json(
        {
          error:
            "The attached sessions can't go with this: answer the prompt first, then send them with a message.",
        },
        { status: 409 }
      );
    }
    const notice =
      prefixable && getUndoNotice(session.id)
        ? takeUndoNotice(session.id)
        : null;
    if (notice) log("Prefixing the pending undo notice");
    let block: string | null = null;
    if (prefixable && refs.length) {
      try {
        block = await resolveAttachmentBlock(session.id, refs);
      } catch (error) {
        if (notice) setUndoNotice(session.id, notice);
        throw error;
      }
      if (block) log(`Prefixing ${refs.length} attached session(s)`);
    }
    const outgoing = block
      ? composeOutgoing(notice, block, message)
      : notice
        ? `${notice} ${message}`
        : message;

    try {
      log(`Pasting ${outgoing.length} bytes to ${tmuxSessionName}`);
      await sendText(session, outgoing, { pressEnter });
      log(`=== SUCCESS ===`);
      return NextResponse.json({ success: true });
    } catch (cmdError) {
      if (notice) setUndoNotice(session.id, notice);
      const msg =
        cmdError instanceof Error ? cmdError.message : String(cmdError);
      log(`ERROR in commands: ${msg}`);
      throw cmdError;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${msg}`);
    console.error("Error sending keys:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
