import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requester, userOnly } from "@/lib/permission-guard";
import {
  NotLimitedError,
  cancelResume,
  scheduleResume,
} from "@/lib/limits/resume";
import { MAX_RESUME_TEXT, type ResumeRequest } from "@/lib/limits/types";

function getSession(id: string): Session | null {
  return (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;
}

/** The request body as a ResumeRequest, or what is wrong with it */
function parseRequest(body: unknown): ResumeRequest | string {
  if (!body || typeof body !== "object") return "Expected a JSON body";
  const { when, text } = body as Record<string, unknown>;
  if (when !== "reset" && when !== "now" && when !== "snooze") {
    return "when must be reset, now or snooze";
  }
  if (text !== undefined && typeof text !== "string") {
    return "text must be a string";
  }
  if (typeof text === "string" && text.length > MAX_RESUME_TEXT) {
    return "Text is too long";
  }
  return { when, text };
}

/** Only the user schedules resumes: an agent gets a 403 */
function refuseAgents(request: NextRequest): NextResponse | null {
  const who = requester(request);
  if (who.by === "user") return null;
  if (who.by === null) return userOnly(who.reason);
  return NextResponse.json(
    { error: "Agents can't schedule or cancel resumes" },
    { status: 403 }
  );
}

// POST /api/sessions/[id]/resume {when: 'reset'|'now'|'snooze', text?} -
// ResumeResult (lib/limits/types.ts). 409 when the session isn't limited
// (Resume now also goes for a session with a policy set)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = parseRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const refused = refuseAgents(request);
  if (refused) return refused;

  try {
    return NextResponse.json(await scheduleResume(session, parsed));
  } catch (error) {
    if (error instanceof NotLimitedError) {
      return NextResponse.json({ error: "not_limited" }, { status: 409 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[resume] schedule failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]/resume - ResumeResult: cancels a scheduled
// resume or a snooze
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const refused = refuseAgents(request);
  if (refused) return refused;
  return NextResponse.json(cancelResume(session));
}
