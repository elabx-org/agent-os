/**
 * Settle and unsettle a session (M8, N-Settle). Settling ends its tmux and
 * keeps the row, transcript, worktree, branch and snapshot refs; unsettling
 * clears settled_at and relaunches the agent (Claude with --resume). Server
 * only. Types in lib/settle-types.ts.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type Database from "better-sqlite3";
import { readClaudeState } from "./claude-state";
import { gitCommonDir } from "./git-common-dir";
import { getDb, queries, type Project, type Session } from "./db";
import { isPaused } from "./handoff-types";
import { savePausedHistory } from "./paused-history";
import { isWatching, readPushConfig } from "./push/config";
import { recordNotification, setDelivered } from "./push/history";
import { sendPush } from "./push/send";
import { listQueue } from "./queue/store";
import type { QueueItem } from "./queue/types";
import { latest } from "./session-watch";
import { isRunning, launchSession, tmuxNameOf } from "./session-launch";
import {
  UNSETTLED_REASON,
  isSettled,
  settledToday,
  type SettledFilter,
  type SettleError,
  type SettleReason,
} from "./settle-types";
import { locateTranscript, sessionCwd } from "./transcript-locate";

const execFileAsync = promisify(execFile);

/** A refusal the routes turn into its status and SettleError body */
export class SettleRefused extends Error {
  constructor(
    readonly status: number,
    readonly body: SettleError
  ) {
    super(body.error);
  }
}

export interface SettleOptions {
  reason: SettleReason;
  /**
   * Settle although it is working or has queued messages (they stay
   * queued, held until an Undo)
   */
  force?: boolean;
}

/** GET /api/sessions?settled=: 0 not settled, 1 settled, today settled today */
export function filterSettled<S extends Pick<Session, "settled_at">>(
  sessions: S[],
  filter: SettledFilter | null,
  now: number = Date.now()
): S[] {
  if (filter === "0") return sessions.filter((s) => !isSettled(s));
  if (filter === "1") return sessions.filter((s) => isSettled(s));
  if (filter === "today") return sessions.filter((s) => settledToday(s, now));
  return sessions;
}

/** What settling touches, so the tests run it without tmux */
export interface SettleDeps {
  db: Database.Database;
  now(): number;
  /** session-watch's last stable status, null when not watched */
  status(sessionId: string): string | null;
  /** Pending and sending queue items */
  listQueue(sessionId: string): QueueItem[];
  isRunning(session: Session): Promise<boolean>;
  /**
   * Keeps the conversation the pane shows as claude_session_id, so the
   * settled chat and the Undo's --resume open that one
   */
  rememberTranscript(session: Session): Promise<void>;
  /** A Codex or Gemini session's terminal history (it has no transcript) */
  keepHistory(session: Session): Promise<void>;
  /** Ends the session's tmux */
  kill(session: Session): Promise<void>;
  /** Starts the agent again (Claude resumes claude_session_id) */
  launch(session: Session): Promise<boolean>;
  /** The "settled" push of an automatic settle */
  announce(session: Session): void;
  /** The repo a folder belongs to (git common dir), null when not a repo */
  repoOf(dir: string): Promise<string | null>;
}

function getSession(db: Database.Database, id: string): Session | null {
  return (queries.getSession(db).get(id) as Session | undefined) ?? null;
}

const isClaude = (session: Session) =>
  (session.agent_type || "claude") === "claude";

/** Working or waiting on screen, or messages still to send */
function busy(deps: SettleDeps, session: Session): boolean {
  const status = deps.status(session.id);
  if (status === "running" || status === "waiting") return true;
  return deps.listQueue(session.id).length > 0;
}

/**
 * session-watch's status for settling. Its "waiting" stays on after any
 * turn until someone looks (status-detector's acknowledged); a Claude
 * session whose hooks say the turn ended with nothing to answer is idle
 */
export function settleStatus(sessionId: string): string | null {
  const status = latest(sessionId)?.status ?? null;
  if (status !== "waiting") return status;
  const hooks = readClaudeState(sessionId);
  return hooks.busy === false && !hooks.pendingPermission ? "idle" : status;
}

export function createSettle(deps: SettleDeps) {
  async function settle(
    session: Session,
    options: SettleOptions
  ): Promise<Session> {
    if (isPaused(session)) {
      throw new SettleRefused(409, {
        error: "This session is paused",
        reason: "paused",
      });
    }
    if (isSettled(session)) {
      throw new SettleRefused(409, {
        error: "This session is already settled",
        reason: "already_settled",
      });
    }
    if (!options.force && busy(deps, session)) {
      throw new SettleRefused(409, {
        error: "This session is working or has queued messages",
        reason: "busy",
      });
    }

    // settled_at before any await: from here readiness holds what is sent
    const { changes } = deps.db
      .prepare(
        `UPDATE sessions SET settled_at = ?, settled_reason = ?,
           updated_at = datetime('now')
         WHERE id = ? AND settled_at IS NULL AND paused_at IS NULL`
      )
      .run(deps.now(), options.reason, session.id);
    if (changes !== 1) {
      throw new SettleRefused(409, {
        error: "This session is already settled",
        reason: "already_settled",
      });
    }
    // Queued messages are kept: held while settled, sent after an Undo

    const running = await deps.isRunning(session).catch(() => false);
    if (running) {
      const keep = isClaude(session)
        ? deps.rememberTranscript(session)
        : deps.keepHistory(session);
      await keep.catch((error) => {
        console.error("[settle] keeping the chat:", error);
      });
      await deps.kill(session).catch((error) => {
        // Gone already is as good as ended
        console.error("[settle] ending tmux:", error);
      });
    }
    const settled = getSession(deps.db, session.id)!;
    if (options.reason === "pr_merged") deps.announce(settled);
    return settled;
  }

  async function unsettle(
    session: Session
  ): Promise<{ session: Session; relaunched: boolean }> {
    if (!isSettled(session)) {
      throw new SettleRefused(409, {
        error: "This session isn't settled",
        reason: "not_settled",
      });
    }
    const { changes } = deps.db
      .prepare(
        `UPDATE sessions SET settled_at = NULL, settled_reason = ?,
           updated_at = datetime('now')
         WHERE id = ? AND settled_at IS NOT NULL`
      )
      .run(UNSETTLED_REASON, session.id);
    if (changes !== 1) {
      throw new SettleRefused(409, {
        error: "This session isn't settled",
        reason: "not_settled",
      });
    }
    const fresh = getSession(deps.db, session.id)!;
    let relaunched = false;
    // Never a blank Claude in its place: without a conversation to resume
    // it waits to be opened
    if (!isClaude(fresh) || fresh.claude_session_id) {
      try {
        await deps.launch(fresh);
        relaunched = true;
      } catch (error) {
        console.error("[settle] relaunch:", error);
      }
    }
    return { session: getSession(deps.db, session.id) ?? fresh, relaunched };
  }

  async function settlePrOwner(
    repoDir: string,
    prNumber: number,
    options: { settle: boolean }
  ): Promise<Session | null> {
    const candidates = deps.db
      .prepare(
        `SELECT * FROM sessions WHERE pr_number = ? AND settled_at IS NULL
           AND paused_at IS NULL
         ORDER BY updated_at DESC`
      )
      .all(prNumber) as Session[];
    if (candidates.length === 0) return null;
    const repo = await deps.repoOf(repoDir);
    if (!repo) return null;
    for (const candidate of candidates) {
      if ((await deps.repoOf(sessionCwd(candidate))) !== repo) continue;
      deps.db
        .prepare(
          `UPDATE sessions SET pr_status = 'merged',
             pr_merged_at = COALESCE(pr_merged_at, ?)
           WHERE id = ?`
        )
        .run(deps.now(), candidate.id);
      if (!options.settle) return null;
      // Working or with messages queued: it keeps the "merged · Settle" chip
      return settle(getSession(deps.db, candidate.id)!, {
        reason: "pr_merged_here",
      }).catch((error) => {
        if (error instanceof SettleRefused) return null;
        throw error;
      });
    }
    return null;
  }

  return { settle, unsettle, settlePrOwner };
}

/** "Project · name", or the name in Uncategorized */
function where(db: Database.Database, session: Session): string {
  const project = session.project_id
    ? (queries.getProject(db).get(session.project_id) as Project | undefined)
    : undefined;
  return project && !project.is_uncategorized
    ? `${project.name} · ${session.name}`
    : session.name;
}

/** As lib/limits/watch.ts notify: the history always, a push when wanted */
function announceSettled(session: Session): void {
  const db = getDb();
  const message = {
    kind: "settled" as const,
    sessionId: session.id,
    title: `Settled · ${where(db, session)}`,
    body:
      session.pr_number != null
        ? `PR #${session.pr_number} merged`
        : "Its PR merged",
  };
  const entry = recordNotification(message);
  if (process.env.AGENTOS_DISABLE_PUSH === "1") return;
  const config = readPushConfig();
  const channels = config.ntfy.enabled || config.apns.enabled;
  if (!channels || !config.events.settled) return;
  if (isWatching(session.id)) return;
  sendPush({ ...message }).then((report) => {
    console.log(`[settle] ${message.title}:`, JSON.stringify(report));
    setDelivered(entry.id, report);
  });
}

const liveDeps = (): SettleDeps => ({
  db: getDb(),
  now: Date.now,
  status: settleStatus,
  listQueue,
  isRunning,
  rememberTranscript: async (session) => {
    const located = await locateTranscript(session);
    if (located && located.sessionId !== session.claude_session_id) {
      queries.updateSessionClaudeId(getDb()).run(located.sessionId, session.id);
    }
  },
  keepHistory: savePausedHistory,
  kill: async (session) => {
    await execFileAsync("tmux", [
      "kill-session",
      "-t",
      `=${tmuxNameOf(session)}`,
    ]);
  },
  launch: (session) => launchSession(session),
  announce: announceSettled,
  repoOf: gitCommonDir,
});

let instance: ReturnType<typeof createSettle> | null = null;
const live = () => (instance ??= createSettle(liveDeps()));

/**
 * Settles the session: sets settled_at/settled_reason, ends its tmux,
 * pushes "settled" for automatic ones. Throws SettleRefused (busy without
 * force, already settled, paused). Returns the updated row
 */
export async function settleSession(
  session: Session,
  options: SettleOptions
): Promise<Session> {
  return live().settle(session, options);
}

/**
 * Undo: clears settled_at (settled_reason = UNSETTLED_REASON) and
 * relaunches the agent. Throws SettleRefused when it isn't settled
 */
export async function unsettleSession(
  session: Session
): Promise<{ session: Session; relaunched: boolean }> {
  return live().unsettle(session);
}

/**
 * After a merge from Agent-OS: marks the PR merged on the session whose
 * branch it was (pr_number in that repo) and, with `settle`, settles it
 * when it is idle with nothing queued. The settled session, else null
 */
export async function settlePrOwner(
  repoDir: string,
  prNumber: number,
  options: { settle: boolean }
): Promise<Session | null> {
  return live().settlePrOwner(repoDir, prNumber, options);
}

/**
 * Clears settled_at on settled sessions whose tmux runs again (a previous
 * build, which doesn't know settled_at, opened them): they are working
 * sessions, not settled ones. Skips settles of the last minute (their
 * tmux is still being ended). Returns how many it cleared
 */
export async function reconcileSettled(
  now: number = Date.now()
): Promise<number> {
  const db = getDb();
  const settled = db
    .prepare(
      `SELECT * FROM sessions WHERE settled_at IS NOT NULL AND settled_at < ?`
    )
    .all(now - 60 * 1000) as Session[];
  let cleared = 0;
  for (const session of settled) {
    if (!(await isRunning(session).catch(() => false))) continue;
    cleared += db
      .prepare(
        `UPDATE sessions SET settled_at = NULL, settled_reason = ?,
           updated_at = datetime('now')
         WHERE id = ? AND settled_at IS NOT NULL`
      )
      .run(UNSETTLED_REASON, session.id).changes;
  }
  return cleared;
}
