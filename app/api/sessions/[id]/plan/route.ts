import fs from "fs/promises";
import { NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript } from "@/lib/claude-transcript";
import { planFromEntries, type PlanResponse } from "@/lib/claude-plan";
import { tmuxNameOf } from "@/lib/session-launch";

/** Enough of the tail for the latest todos and the last message's usage */
const TAIL_BYTES = 2_000_000;

const NONE: PlanResponse = { plan: null, tokens: null };

/** The parsed JSONL lines in the file's last `bytes`, oldest first */
async function readTailEntries(file: string, bytes: number) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const from = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - from);
    await handle.read(buf, 0, buf.length, from);
    let lines = buf.toString("utf8").split("\n");
    // Starting mid-file starts mid-line
    if (from > 0) lines = lines.slice(1);
    const entries: unknown[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Malformed, or the last line still being written
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}

// GET /api/sessions/[id]/plan -> PlanResponse: Claude's plan (latest
// TodoWrite / task calls) and the context size, from the transcript's tail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.agent_type && session.agent_type !== "claude") {
    return NextResponse.json(NONE);
  }

  const found = await findTranscript(tmuxNameOf(session));
  if (!found?.file) return NextResponse.json(NONE);
  try {
    const entries = await readTailEntries(found.file, TAIL_BYTES);
    return NextResponse.json(planFromEntries(entries));
  } catch (error) {
    console.error("Error reading the plan:", error);
    return NextResponse.json(NONE);
  }
}
