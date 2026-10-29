/**
 * Whether a session's agent is idle enough to undo a turn under it: not
 * running at all, ready for a message (lib/session-ready.ts), its Claude
 * hooks saying it is done, or the session watch / status detector reading
 * idle.
 */

import { readClaudeState } from "./claude-state";
import type { Session } from "./db";
import { readiness, type Readiness } from "./session-ready";
import { isRunning, tmuxNameOf } from "./session-launch";
import { latest } from "./session-watch";
import { statusDetector, type SessionStatus } from "./status-detector";

export interface IdleDeps {
  running: (session: Session) => Promise<boolean>;
  readiness: (session: Session) => Promise<Readiness>;
  status: (session: Session) => Promise<SessionStatus>;
  claudeBusy: (session: Session) => boolean | null;
}

const liveDeps: IdleDeps = {
  running: isRunning,
  readiness,
  status: async (session) =>
    latest(session.id)?.status ??
    (await statusDetector.getStatus(tmuxNameOf(session))),
  claudeBusy: (session) => {
    const state = readClaudeState(session.id);
    if (state.busy === null) return null;
    return state.busy || state.pendingPermission !== null;
  },
};

export async function agentIdle(
  session: Session,
  deps: IdleDeps = liveDeps
): Promise<boolean> {
  if (!(await deps.running(session))) return true;
  if ((await deps.readiness(session)).ready) return true;
  if (session.agent_type === "claude") {
    const busy = deps.claudeBusy(session);
    if (busy !== null) return !busy;
  }
  const status = await deps.status(session);
  return status === "idle" || status === "dead";
}
