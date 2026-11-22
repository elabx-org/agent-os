import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { queries, getDb, type Session } from "@/lib/db";
import {
  answerAsk,
  AskError,
  parseAskScreen,
  type AskAnswer,
  type AskIO,
  type AskQuestionSpec,
} from "@/lib/ask-screen";
import { PERMISSION_RELOAD } from "@/lib/agent-origin";
import { requireUser } from "@/lib/user-proof";
import { askLabelsMatch } from "@/lib/session-guards";

const execFileAsync = promisify(execFile);

/** Sessions being answered now, so a second tap can't interleave its keys */
const busy = new Set<string>();

function tmuxIO(target: string): AskIO {
  return {
    async read() {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-p",
        "-t",
        target,
      ]);
      return parseAskScreen(stdout.split("\n"));
    },
    async keys(...keys) {
      await execFileAsync("tmux", ["send-keys", "-t", target, ...keys]);
    },
    async type(text) {
      await execFileAsync("tmux", ["send-keys", "-t", target, "-l", text]);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

// POST /api/sessions/[id]/ask - Answer Claude's AskUserQuestion screen:
// { questions: [{ question, multiSelect, optionCount }], answers: [{ picks,
// other? }] }. Every question is answered, then submitted; each key waits for
// the screen to show it landed (lib/ask-screen.ts). The user's only.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: PERMISSION_RELOAD, reason: proof.reason },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    questions?: AskQuestionSpec[];
    answers?: AskAnswer[];
    labels?: string[][];
  } | null;
  const questions = body?.questions;
  const answers = body?.answers;
  if (
    !Array.isArray(questions) ||
    !Array.isArray(answers) ||
    !questions.length
  ) {
    return NextResponse.json({ error: "Nothing to answer" }, { status: 400 });
  }

  if (busy.has(id)) {
    return NextResponse.json({ error: "Already answering" }, { status: 409 });
  }
  busy.add(id);
  const target =
    session.tmux_name || `${session.agent_type || "claude"}-${session.id}`;
  try {
    const io = tmuxIO(target);
    if (body?.labels !== undefined) {
      // One question shows at a time: the labels cover the one on screen
      const screen = await io.read();
      const onScreen =
        screen?.kind === "question"
          ? [
              {
                options: screen.rows
                  .slice(0, questions[0]?.optionCount ?? 0)
                  .map((r) => ({ label: r.label })),
              },
            ]
          : [];
      if (!askLabelsMatch(onScreen, body.labels)) {
        return NextResponse.json(
          { error: "The question changed; check the session" },
          { status: 409 }
        );
      }
    }
    await answerAsk(io, questions, answers);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AskError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Session not running" }, { status: 409 });
  } finally {
    busy.delete(id);
  }
}
