import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { isAutoSessionName } from "@/lib/session-names";
import { getSessionTitle } from "@/lib/session-titles";

// Each id may cost a tmux call, so a request is capped
const MAX_IDS = 100;

// GET /api/sessions/titles?ids=a,b,c
// Titles for Claude sessions: a renamed one keeps its name, an auto-named one
// gets its transcript's title. Unknown, non-Claude or untitled ids are left out.
export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  const titles: Record<string, string> = {};
  try {
    const getSession = queries.getSession(getDb());
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const session = getSession.get(id) as Session | undefined;
        if (!session) return;
        if (session.agent_type && session.agent_type !== "claude") return;
        if (!isAutoSessionName(session.name)) {
          titles[id] = session.name;
          return;
        }
        const title = await getSessionTitle(
          session.tmux_name || `claude-${id}`
        );
        if (title) titles[id] = title;
      })
    );
  } catch (error) {
    console.error("Error reading session titles:", error);
  }
  return NextResponse.json({ titles });
}
