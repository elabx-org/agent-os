/**
 * Auto-settle (M8, flag autoSettle): a session whose PR merged settles only
 * when it is safe (idle, nothing queued, no user message or terminal input
 * in AUTO_SETTLE_QUIET_MS, not focused on any client, not undone before);
 * otherwise it keeps the "PR #N merged · Settle" chip and is weighed again
 * on the next poll.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type Database from "better-sqlite3";
import { getDb, type Session } from "./db";
import { getFlags } from "./flags";
import { isWatching } from "./push/config";
import { queueStore } from "./queue/store";
import { isRunning, tmuxNameOf } from "./session-launch";
import { latest } from "./session-watch";
import { SettleRefused, settleSession, type SettleOptions } from "./settle";
import {
  AUTO_SETTLE_QUIET_MS,
  UNSETTLED_REASON,
  isEnded,
  type AutoSettleBlock,
  type AutoSettleInput,
} from "./settle-types";

const execFileAsync = promisify(execFile);

/** Null when it may settle now, else what stops it. Pure */
export function autoSettleBlock(
  input: AutoSettleInput
): AutoSettleBlock | null {
  const { session } = input;
  if (isEnded(session)) return "ended";
  if (session.settled_reason === UNSETTLED_REASON) return "undone";
  if (!input.autoSettleOn) return "flag_off";
  if (input.status !== "idle" && input.status !== "dead") return "not_idle";
  if (input.pendingQueue > 0) return "queued";
  if (
    input.lastInputAt != null &&
    input.now - input.lastInputAt < AUTO_SETTLE_QUIET_MS
  )
    return "recent_input";
  if (input.focused) return "focused";
  return null;
}

/** The latest of the session's queued messages and turn starts (ms), from the DB */
export function lastDbInputAt(
  db: Database.Database,
  sessionId: string
): number | null {
  const queued = db
    .prepare(
      `SELECT MAX(created_at) AS at FROM session_queue
       WHERE session_id = ? AND origin = 'user'`
    )
    .get(sessionId) as { at: number | null } | undefined;
  const turn = db
    .prepare(
      `SELECT MAX(started_at) AS at FROM session_turns WHERE session_id = ?`
    )
    .get(sessionId) as { at: number | null } | undefined;
  return maxOf([queued?.at ?? null, turn?.at ?? null]);
}

/** tmux's last key from any attached client (ms); null when none is attached */
export async function lastClientActivity(
  tmuxName: string
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["list-clients", "-t", `=${tmuxName}`, "-F", "#{client_activity}"],
      { timeout: 3000 }
    );
    return maxOf(
      stdout
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((s) => s * 1000)
    );
  } catch {
    return null;
  }
}

function maxOf(values: readonly (number | null)[]): number | null {
  const known = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  return known.length ? Math.max(...known) : null;
}

/** ms of the session's last user message or terminal input; null when unknown */
export async function lastInputAt(session: Session): Promise<number | null> {
  return maxOf([
    lastDbInputAt(getDb(), session.id),
    await lastClientActivity(tmuxNameOf(session)),
  ]);
}

/** What the pass needs from the world; tests swap in fakes */
export interface AutoSettleDeps {
  db: Database.Database;
  autoSettleOn(): boolean;
  /** session-watch's stable status, or "dead"/null when it has none */
  status(session: Session): Promise<string | null>;
  pendingQueue(sessionId: string): number;
  lastInputAt(session: Session): Promise<number | null>;
  focused(sessionId: string): boolean;
  settle(session: Session, options: SettleOptions): Promise<Session>;
  now(): number;
}

async function watchedStatus(session: Session): Promise<string | null> {
  const seen = latest(session.id);
  if (seen) return seen.status;
  // Not in the poll: its tmux ended (or the poll hasn't seen it yet)
  return (await isRunning(session)) ? null : "dead";
}

export function defaultAutoSettleDeps(): AutoSettleDeps {
  const db = getDb();
  return {
    db,
    autoSettleOn: () => getFlags().autoSettle,
    status: watchedStatus,
    pendingQueue: (id) => queueStore(db).listQueue(id).length,
    lastInputAt,
    focused: isWatching,
    settle: settleSession,
    now: Date.now,
  };
}

// The sessions this process auto-settled: each goes once, whatever comes after
const shared = globalThis as typeof globalThis & {
  __agentosAutoSettled?: Set<string>;
};
const settledOnce = (shared.__agentosAutoSettled ??= new Set());

/** Weighs every merged, unsettled session and settles the safe ones */
export async function autoSettlePass(
  deps: AutoSettleDeps = defaultAutoSettleDeps()
): Promise<number> {
  if (!deps.autoSettleOn()) return 0;
  const candidates = deps.db
    .prepare(
      `SELECT * FROM sessions WHERE pr_status = 'merged'
         AND settled_at IS NULL AND paused_at IS NULL
         AND (settled_reason IS NULL OR settled_reason != ?)`
    )
    .all(UNSETTLED_REASON) as Session[];
  let settled = 0;
  for (const session of candidates) {
    if (settledOnce.has(session.id)) continue;
    const block = autoSettleBlock({
      session,
      autoSettleOn: deps.autoSettleOn(),
      status: await deps.status(session),
      pendingQueue: deps.pendingQueue(session.id),
      lastInputAt: await deps.lastInputAt(session),
      focused: deps.focused(session.id),
      now: deps.now(),
    });
    if (block) continue;
    try {
      await deps.settle(session, { reason: "pr_merged", force: false });
      settledOnce.add(session.id);
      settled++;
    } catch (error) {
      // Busy by the time it got there (or settled meanwhile): the chip stays
      if (error instanceof SettleRefused) continue;
      console.error(`[auto-settle] ${session.id}:`, error);
    }
  }
  return settled;
}
