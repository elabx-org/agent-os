import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb, type Session } from "@/lib/db";
import { isWidgetKey } from "@/lib/widget-key";
import { latest } from "@/lib/session-watch";
import { sessionState } from "@/lib/paused";
import { dbTimeMs, STATE_WORD, type AgentState } from "@/lib/agent-state";
import { isAutoSessionName } from "@/lib/session-names";
import { getSessionTitle } from "@/lib/session-titles";
import { parsePermissionPrompt } from "@/lib/permission-prompt";
import { cachedClaudeUsage, getClaudeUsage } from "@/lib/claude-usage";

const execAsync = promisify(exec);

/** Enough for the large widget; the small ones show the first */
const MAX_SESSIONS = 6;
const MAX_DETAIL = 60;

/** Needs you first, then working, then the rest by when they last moved */
const ORDER: Partial<Record<AgentState, number>> = {
  needs: 0,
  work: 1,
  limited: 2,
};

export interface WidgetSession {
  id: string;
  title: string;
  project: string | null;
  state: AgentState;
  /** "Needs you · npm run build", "Working", "Idle" */
  line: string;
  /** When it entered this state (ms) */
  since: number;
}

export interface WidgetFeed {
  at: number;
  needs: number;
  working: number;
  sessions: WidgetSession[];
  usage: {
    fiveHour: { percent: number | null; resetsAt: string | null };
    week: { percent: number | null; resetsAt: string | null };
  } | null;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL
    ? `${flat.slice(0, MAX_DETAIL - 1).trimEnd()}…`
    : flat;
}

/** What a waiting session asks: the command or file, else the question */
async function asking(tmuxName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${tmuxName}" -p 2>/dev/null || true`
    );
    const prompt = parsePermissionPrompt(stdout.split("\n"), 1000);
    if (!prompt) return null;
    const first = prompt.detail.split("\n").find((l) => l.trim());
    return clip(first || prompt.question || prompt.title) || null;
  } catch {
    return null;
  }
}

// GET /api/widget, with the widget key as a bearer token (or ?key=): the
// live sessions and Claude's usage, for the iOS Home and Lock Screen widgets
export async function GET(request: NextRequest) {
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!isWidgetKey(bearer || request.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ error: "Wrong widget key" }, { status: 401 });
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*, CASE WHEN p.is_uncategorized THEN NULL ELSE p.name END
         AS project_name FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.paused_at IS NULL`
    )
    .all() as (Session & { project_name: string | null })[];

  const now = Date.now();
  const live = rows
    .map((row) => {
      const watched = latest(row.id);
      if (!watched || watched.status === "dead") return null;
      const state = sessionState(row, watched.status);
      if (state === "settled") return null;
      const since =
        state === "needs" || state === "work"
          ? watched.since
          : dbTimeMs(row.updated_at);
      return { row, state, since };
    })
    .filter((s) => s !== null)
    .sort(
      (a, b) =>
        (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || b.since - a.since
    );

  const sessions = await Promise.all(
    live.slice(0, MAX_SESSIONS).map(async ({ row, state, since }) => {
      const tmuxName = row.tmux_name || `claude-${row.id}`;
      const title =
        (row.agent_type === "claude" || !row.agent_type) &&
        isAutoSessionName(row.name)
          ? ((await getSessionTitle(tmuxName)) ?? row.name)
          : row.name;
      const detail = state === "needs" ? await asking(tmuxName) : null;
      const word = STATE_WORD[state];
      return {
        id: row.id,
        title,
        project: row.project_name,
        state,
        line: detail ? `${word} · ${detail}` : word,
        since,
      } satisfies WidgetSession;
    })
  );

  let usage = cachedClaudeUsage();
  if (!usage) {
    const result = await getClaudeUsage();
    usage = "data" in result ? result.data : null;
  }

  const feed: WidgetFeed = {
    at: now,
    needs: live.filter((s) => s.state === "needs").length,
    working: live.filter((s) => s.state === "work").length,
    sessions,
    usage: usage && {
      fiveHour: {
        percent: usage.five_hour.utilization,
        resetsAt: usage.five_hour.resets_at,
      },
      week: {
        percent: usage.seven_day.utilization,
        resetsAt: usage.seven_day.resets_at,
      },
    },
  };
  return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
}
