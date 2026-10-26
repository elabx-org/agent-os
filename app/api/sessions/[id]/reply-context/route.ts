import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript, readTranscriptTail } from "@/lib/claude-transcript";
import { lastTurnContext, type ReplyContext } from "@/lib/reply-context";

// A small tail usually holds the whole last turn; a long one (big tool
// results) gets a second, larger read
const TAILS = [200_000, 1_500_000];
const MAX_CACHED = 50;

/** By transcript file: polled every 2s while typing, mostly unchanged */
const cache = new Map<
  string,
  { size: number; mtimeMs: number; context: ReplyContext | null }
>();

function readContext(file: string, cwd: string): ReplyContext | null {
  const { size, mtimeMs } = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.context;

  let context: ReplyContext | null = null;
  for (const bytes of TAILS) {
    const { items, whole } = readTranscriptTail(file, cwd, bytes);
    context = lastTurnContext(items);
    // Your last message is in it (or it's the whole file): the turn is whole
    if (whole || items.some((i) => i.kind === "user")) break;
  }
  cache.delete(file);
  cache.set(file, { size, mtimeMs, context });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return context;
}

// GET /api/sessions/[id]/reply-context - What a reply answers: the question
// Claude is waiting on or its last message ({ context: null } if nothing)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.agent_type && session.agent_type !== "claude") {
    return NextResponse.json({ context: null });
  }

  const found = await findTranscript(session.tmux_name || `claude-${id}`);
  if (!found?.file) return NextResponse.json({ context: null });
  try {
    return NextResponse.json({ context: readContext(found.file, found.cwd) });
  } catch (error) {
    console.error("Error reading reply context:", error);
    return NextResponse.json({ context: null });
  }
}
