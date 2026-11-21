/**
 * What the session routes allow a caller from another machine
 * (lib/link/from-machine.ts names it). The hub's rule table
 * (lib/link/up-agent-rules.ts) is the first layer; these checks are the
 * real boundary, and they also run on a third machine that a relayed call
 * reaches. A session elsewhere gets no shell here: only Claude sessions,
 * plain messages, and only to sessions that ask before they act.
 */

import { NextResponse } from "next/server";
import type { Session } from "./db";
import { effectiveMode, isEscalation } from "./permission-mode";
import { parseMovedTo } from "./session-move-types";
import { parseStartedBy } from "./session-started-by";

export type FromMachineCode =
  | "claude_only"
  | "plain_text_only"
  | "asks_first_only"
  | "too_many_running"
  | "chain_too_deep"
  | "project_required";

/** Sessions started from one machine that may run here at once */
export const MAX_RUNNING_FROM_MACHINE = 5;

export const FROM_MACHINE_ERRORS: Record<
  FromMachineCode,
  { status: number; error: string }
> = {
  claude_only: {
    status: 403,
    error: "Sessions on another machine can only work with Claude sessions.",
  },
  plain_text_only: {
    status: 403,
    error: "Only plain messages can be sent from another machine: no commands.",
  },
  asks_first_only: {
    status: 403,
    error:
      "This session doesn't ask before acting, so only the user can give it work.",
  },
  too_many_running: {
    status: 429,
    error: `${MAX_RUNNING_FROM_MACHINE} sessions started from that machine are already running here. Stop one first.`,
  },
  chain_too_deep: {
    status: 409,
    error:
      "Sessions have started each other across machines 3 times in a row. Ask the user to start this one.",
  },
  project_required: {
    status: 400,
    error:
      "Name a project on that machine. A session from another machine can only start inside one of its projects.",
  },
};

export function fromMachineRefusal(code: FromMachineCode): NextResponse {
  const { status, error } = FROM_MACHINE_ERRORS[code];
  return NextResponse.json(
    { error, code },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** Only Claude sessions take work from another machine */
export const isClaudeSession = (session: Pick<Session, "agent_type">) =>
  (session.agent_type || "claude") === "claude";

/** Anything Claude Code would run as a command, or a key that isn't text */
const COMMAND = /^\s*[!/#]/;
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/**
 * A message from another machine to a session with no prompt on screen:
 * plain text only, and only to a session that asks before acting
 */
export function messageRefusal(
  session: Session,
  text: string
): FromMachineCode | null {
  if (COMMAND.test(text) || CONTROL.test(text)) return "plain_text_only";
  if (isEscalation(effectiveMode(session), "manual")) return "asks_first_only";
  return null;
}

/**
 * A settled session that went on to another machine: where it continues,
 * for every caller, so a tool can follow it
 */
export function movedAnswer(session: Session): NextResponse | null {
  const moved = session.settled_at ? parseMovedTo(session.moved_to) : null;
  if (!moved) return null;
  return NextResponse.json(
    {
      code: "moved",
      machine: moved.machine,
      name: moved.name,
      error: `It continues on ${moved.name}.`,
    },
    { status: 409 }
  );
}

/** The sessions here that a session on `machineId` started and that still run */
export async function runningFrom(
  machineId: string,
  sessions: Session[],
  isRunning: (session: Session) => Promise<boolean>
): Promise<number> {
  const mine = sessions.filter(
    (s) => parseStartedBy(s.started_by)?.machineId === machineId
  );
  const live = await Promise.all(
    mine.map((s) => isRunning(s).catch(() => false))
  );
  return live.filter(Boolean).length;
}
