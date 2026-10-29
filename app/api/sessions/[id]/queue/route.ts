import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import {
  agentActorSessionId,
  forgetRetried,
  recordRefusal,
} from "@/lib/agent-actions";
import { requester, userOnly } from "@/lib/permission-guard";
import { effectiveMode } from "@/lib/permission-mode";
import { flagOnFor } from "@/lib/flags";
import { readiness } from "@/lib/session-ready";
import { getUndoNotice, listFailed, listQueue } from "@/lib/queue/store";
import { sendOrQueue } from "@/lib/queue/dispatcher";
import type { EnqueueRequest, QueueState } from "@/lib/queue/types";

const MAX_TEXT = 100_000;
const MAX_ATTACHMENTS = 50;

function getSession(id: string): Session | null {
  return (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;
}

/** The request body as an EnqueueRequest, or what is wrong with it */
function parseRequest(body: unknown): EnqueueRequest | string {
  if (!body || typeof body !== "object") return "Expected a JSON body";
  const { text, attachments, kind, sendNow } = body as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) return "No text provided";
  if (text.length > MAX_TEXT) return "Text is too long";
  if (
    attachments !== undefined &&
    (!Array.isArray(attachments) ||
      attachments.length > MAX_ATTACHMENTS ||
      attachments.some((a) => typeof a !== "string" || !a))
  ) {
    return "Attachments must be a list of file paths";
  }
  if (kind !== undefined && kind !== "message" && kind !== "command") {
    return "Unknown kind";
  }
  if (sendNow !== undefined && typeof sendNow !== "boolean") {
    return "sendNow must be true or false";
  }
  return {
    text,
    attachments: attachments as string[] | undefined,
    kind,
    sendNow,
  };
}

// GET /api/sessions/[id]/queue - QueueState
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!flagOnFor("queue", id)) {
    // The notice still goes, prefixed by send-keys: the chip shows it
    const off: QueueState = {
      items: [],
      failed: [],
      notice: getUndoNotice(id),
      ready: false,
      holdReason: null,
      enabled: false,
    };
    return NextResponse.json(off);
  }
  const { ready, holdReason } = await readiness(session);
  const state: QueueState = {
    items: listQueue(id),
    failed: listFailed(id),
    notice: getUndoNotice(id),
    ready,
    holdReason,
    enabled: true,
  };
  return NextResponse.json(state);
}

// POST /api/sessions/[id]/queue {text, attachments?, kind?, sendNow?} -
// EnqueueResult. The server decides whether it goes straight in (sendNow,
// the session ready and nothing queued ahead) or waits in the queue. Agents
// may queue messages, never commands, and give a full-access session work
// only from a full-access session of their own, as with send-keys.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = parseRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  const db = getDb();
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!flagOnFor("queue", id)) {
    return NextResponse.json({ error: "queue_off" }, { status: 409 });
  }

  const who = requester(request);
  if (who.by !== "user") {
    const audit = {
      targetSessionId: id,
      action: "send_keys" as const,
      detail: parsed.text.slice(0, 200),
    };
    if (parsed.kind === "command") {
      recordRefusal(request, audit);
      if (who.by === null) return userOnly(who.reason);
      return NextResponse.json(
        { error: "Agents can queue messages, not commands" },
        { status: 403 }
      );
    }
    if (effectiveMode(session) === "bypassPermissions") {
      const actorId = agentActorSessionId(request, db);
      const actor = actorId ? getSession(actorId) : null;
      if (!actor || effectiveMode(actor) !== "bypassPermissions") {
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
  } else {
    forgetRetried(id, "send_keys");
  }

  try {
    const result = await sendOrQueue(
      session,
      parsed,
      who.by === "agent" ? "agent" : "user"
    );
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[queue] send failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
