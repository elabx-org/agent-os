/**
 * M8 "Settle" (N-Settle): the shapes shared by the routes
 * (app/api/sessions/[id]/settle, GET /api/sessions?settled=),
 * lib/settle.ts, lib/pr-poller.ts, lib/auto-settle.ts and the Now page. A settled session's tmux ended; its row, transcript, worktree,
 * branch and snapshot refs stay. No server imports.
 */

import type { Session } from "./db/types";
import type { PRChecks, PRState } from "./git-types";

/** Why a session settled (sessions.settled_reason) */
export const SETTLE_REASONS = [
  /** Swiped or picked Settle */
  "manual",
  /** Its PR merged and the poller found it safe to settle */
  "pr_merged",
  /** Its PR was merged from Agent-OS (app/api/git/pr/[number]/merge) */
  "pr_merged_here",
] as const;
export type SettleReason = (typeof SETTLE_REASONS)[number];

/**
 * settled_reason after an Undo (settled_at NULL): auto-settle leaves the
 * session alone from then on, a manual settle still works
 */
export const UNSETTLED_REASON = "unsettled";

/** Settled: its tmux ended, it stays listed and its chat stays readable */
export function isSettled(
  session: { settled_at?: number | null } | null | undefined
): boolean {
  return !!session?.settled_at;
}

/**
 * Ended without being stopped by hand: paused (handed off, M4) or settled.
 * Nothing attaches to it and opening it doesn't relaunch its agent
 */
export function isEnded(
  session:
    | { settled_at?: number | null; paused_at?: number | null }
    | null
    | undefined
): boolean {
  return !!session?.settled_at || !!session?.paused_at;
}

/** Settled on `now`'s local calendar day */
export function settledToday(
  session: Pick<Session, "settled_at">,
  now: number = Date.now()
): boolean {
  if (!session.settled_at) return false;
  const a = new Date(session.settled_at);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** GET /api/sessions?settled=0|1|today; no parameter lists them all */
export type SettledFilter = "0" | "1" | "today";

export function parseSettledFilter(value: string | null): SettledFilter | null {
  return value === "0" || value === "1" || value === "today" ? value : null;
}

/** The branch's PR as a session row keeps it (pr_* columns) */
export interface SessionPr {
  number: number;
  url: string | null;
  state: PRState;
  title: string | null;
  checks: PRChecks;
  /** ms, when merged */
  mergedAt: number | null;
}

/** The row's PR, or null when it has none */
export function sessionPr(
  session: Pick<
    Session,
    | "pr_number"
    | "pr_url"
    | "pr_status"
    | "pr_title"
    | "pr_checks"
    | "pr_merged_at"
  >
): SessionPr | null {
  if (session.pr_number == null) return null;
  const checks = session.pr_checks;
  return {
    number: session.pr_number,
    url: session.pr_url,
    state: session.pr_status ?? "open",
    title: session.pr_title,
    checks:
      checks === "passed" || checks === "failed" || checks === "pending"
        ? checks
        : null,
    mergedAt: session.pr_merged_at,
  };
}

/**
 * Merged and not settled, and auto-settle didn't take it (busy, recently
 * used, focused, or undone): it shows "PR #N merged · Settle"
 */
export function wantsSettleChip(
  session: Pick<Session, "pr_status" | "settled_at" | "paused_at">
): boolean {
  return session.pr_status === "merged" && !isEnded(session);
}

// --- POST/DELETE /api/sessions/[id]/settle (user-only, requireUser) ---

/** POST body */
export interface SettleRequest {
  /** Settle although the session is working or has queued messages */
  force?: boolean;
}

/** POST 200 */
export interface SettleResult {
  session: Session;
}

/** DELETE 200: settled_at cleared, the agent relaunched (Claude --resume) */
export interface UnsettleResult {
  session: Session;
  /** False when the relaunch failed; the session is still unsettled */
  relaunched: boolean;
}

/** Why a settle or unsettle was refused (409 unless noted) */
export type SettleRefusalReason =
  /** Working or queued messages; POST again with force (the user agreed) */
  | "busy"
  | "already_settled"
  | "not_settled"
  /** Handed off (M4): resume-paused, not settle */
  | "paused";

export interface SettleError {
  error: string;
  reason?: SettleRefusalReason;
}

// --- Auto-settle (lib/auto-settle.ts) ---

/** No user message or terminal input for this long before auto-settle */
export const AUTO_SETTLE_QUIET_MS = 30 * 60 * 1000;
/**
 * Only PRs merged this recently settle on their own: older merges (the
 * poller's first pass backfills them) keep the chip
 */
export const AUTO_SETTLE_RECENT_MERGE_MS = 24 * 60 * 60 * 1000;
/** The PR poller's period (flag prPoller) */
export const PR_POLL_MS = 3 * 60 * 1000;

/** Why a merged PR's session was left with the chip instead */
export type AutoSettleBlock =
  | "flag_off"
  | "not_idle"
  | "queued"
  | "recent_input"
  | "unknown_input"
  | "focused"
  | "undone"
  | "ended";

/** What auto-settle weighs for one session whose PR merged */
export interface AutoSettleInput {
  session: Pick<
    Session,
    "settled_at" | "settled_reason" | "paused_at" | "pr_status"
  >;
  autoSettleOn: boolean;
  /** session-watch's status: only "idle" (or "dead") may settle */
  status: string | null;
  pendingQueue: number;
  /**
   * ms of the last user message, terminal input or Claude hook event;
   * null when unknown (blocks unless its tmux is gone)
   */
  lastInputAt: number | null;
  /**
   * Shown in a visible client's focused pane (isWatching in
   * lib/push/config.ts, fed by hooks/usePresence.ts)
   */
  focused: boolean;
  now: number;
}

/** "#107 open · checks passed": the chip's words (Working rows, N-Settle) */
export function prChipLabel(pr: SessionPr, baseBranch?: string | null): string {
  if (pr.state === "merged")
    return baseBranch
      ? `#${pr.number} merged into ${baseBranch}`
      : `#${pr.number} merged`;
  if (pr.state === "closed") return `#${pr.number} closed`;
  return `#${pr.number} open`;
}

/** The subline of a settled row: "Settled automatically · PR #106 merged" */
export function settledLine(
  session: Pick<Session, "settled_reason" | "pr_number" | "pr_status">
): string {
  const pr =
    session.pr_number != null && session.pr_status === "merged"
      ? `PR #${session.pr_number} merged`
      : null;
  const how =
    session.settled_reason === "pr_merged"
      ? "Settled automatically"
      : "Settled";
  return pr ? `${how} · ${pr}` : how;
}
