import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import { lastPromptRow } from "@/lib/last-prompt";

const execFileAsync = promisify(execFile);

const tmux = (...args: string[]) =>
  execFileAsync("tmux", args).then((r) => r.stdout);

// POST /api/sessions/[id]/last-message - Scrolls the session's terminal back
// to where the user's last message starts. tmux holds the history, so this
// finds the message in it and moves copy mode there.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const target = session.tmux_name || `${session.agent_type || "claude"}-${id}`;
  try {
    const [info, text] = await Promise.all([
      tmux(
        "display-message",
        "-p",
        "-t",
        target,
        "#{history_size} #{pane_in_mode}"
      ),
      tmux("capture-pane", "-p", "-t", target, "-S", "-"),
    ]);
    const [history, inMode] = info.trim().split(" ").map(Number);
    const row = lastPromptRow(text.split("\n"));
    if (row < 0) return NextResponse.json({ found: false });
    // Lines up from the bottom of the history, one more to show the line
    // before it
    const up = history - row + 1;
    if (up <= 0) {
      // On the screen already: out of copy mode, if it was in it
      if (inMode) await tmux("send-keys", "-t", target, "-X", "cancel");
      return NextResponse.json({ found: true });
    }
    await tmux("copy-mode", "-t", target);
    await tmux("send-keys", "-t", target, "-X", "goto-line", String(up));
    return NextResponse.json({ found: true });
  } catch {
    return NextResponse.json(
      { error: "No terminal for this session" },
      { status: 409 }
    );
  }
}
