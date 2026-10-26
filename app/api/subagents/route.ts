import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { findTranscript } from "@/lib/claude-transcript";
import { listSubagents, type SubagentInfo } from "@/lib/claude-subagents";

// Each id costs a transcript lookup and a read of its subagents
const MAX_IDS = 20;
/** Finished ones stay listed this long, so a quick agent still shows */
const RECENT_MS = 30 * 60_000;

// GET /api/subagents?sessions=a,b
// The subagents of several sessions at once, each tagged with its session:
// the running ones and those that finished in the last half hour. Unknown
// and non-Claude ids are skipped.
export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("sessions") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const subagents: (SubagentInfo & { sessionId: string })[] = [];
  try {
    const getSession = queries.getSession(getDb());
    const since = Date.now() - RECENT_MS;
    await Promise.all(
      [...new Set(ids)].slice(0, MAX_IDS).map(async (id) => {
        const session = getSession.get(id) as Session | undefined;
        if (!session || session.agent_type !== "claude") return;
        const found = await findTranscript(session.tmux_name || `claude-${id}`);
        if (!found?.file) return;
        for (const agent of listSubagents(found.file)) {
          const recent =
            agent.status === "done" && Date.parse(agent.updatedAt) >= since;
          if (agent.status === "running" || recent) {
            subagents.push({ ...agent, sessionId: id });
          }
        }
      })
    );
  } catch (error) {
    console.error("Error listing subagents:", error);
  }
  return NextResponse.json({ subagents });
}
