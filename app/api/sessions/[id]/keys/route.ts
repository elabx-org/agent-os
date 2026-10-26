import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";

const execFileAsync = promisify(execFile);

// The keys that change Claude Code's state, as tmux names them
const KEYS: Record<string, string[]> = {
  "shift-tab": ["BTab"],
  esc: ["Escape"],
  // Two presses, apart: one chunk would read as Alt+Esc
  "esc-esc": ["Escape", "Escape"],
  up: ["Up"],
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST /api/sessions/[id]/keys {key, times?} - Shift+Tab, Esc, Esc Esc or Up
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { key, times = 1 } = await request.json().catch(() => ({}));
  const keys = KEYS[key as string];
  const count = Math.min(Math.max(Number(times) || 1, 1), 50);
  if (!keys) {
    return NextResponse.json({ error: "Unknown key" }, { status: 400 });
  }
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const target = session.tmux_name || `${session.agent_type || "claude"}-${id}`;
  try {
    for (let n = 0; n < count; n++) {
      for (const [i, name] of keys.entries()) {
        if (i || n) await wait(80);
        await execFileAsync("tmux", ["send-keys", "-t", target, name]);
      }
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Tmux session not running" },
      { status: 400 }
    );
  }
}
