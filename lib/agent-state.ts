import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleSlash,
  Clock,
  Hourglass,
  Loader,
  Moon,
  Square,
  type LucideIcon,
} from "lucide-react";
import { limitStateOf } from "./limits/types";
import type { Session } from "./db/types";

/**
 * One state model for every row: sessions, background agents, subagents and
 * dev servers each map their own status onto these, so a state always has
 * the same word and the same colour wherever it shows. Limited (a usage
 * limit, M6), settled (M8), paused (a handoff, M4) and queued (M2) are here
 * already so the maps below stay the only place that lists them.
 */
export type AgentState =
  | "needs"
  | "work"
  | "done"
  | "idle"
  | "error"
  | "stopped"
  | "limited"
  | "settled"
  | "paused"
  | "queued";

export function fromSessionStatus(status: string): AgentState {
  switch (status) {
    case "waiting":
      return "needs";
    case "running":
      return "work";
    case "error":
      return "error";
    case "dead":
      return "stopped";
    default:
      return "idle";
  }
}

/**
 * A session's state for its rows and dots: limited while it's at a usage
 * limit that hasn't reset (limitStateOf), else what its status says
 */
export function sessionState(
  session: Partial<
    Pick<
      Session,
      | "limited_at"
      | "limited_until"
      | "limit_kind"
      | "resume_policy"
      | "resume_text"
    >
  >,
  status: string | undefined,
  now: number = Date.now()
): AgentState {
  if (limitStateOf(session, now).limited) return "limited";
  return fromSessionStatus(status ?? "idle");
}

// Blocked means it stopped to ask: the same as a waiting session
export function fromBackgroundState(state: string): AgentState {
  switch (state) {
    case "blocked":
      return "needs";
    case "working":
      return "work";
    case "done":
    case "completed":
      return "done";
    default:
      return "idle";
  }
}

export function fromSubagentStatus(status: string): AgentState {
  switch (status) {
    case "running":
      return "work";
    case "done":
      return "done";
    default:
      return "stopped";
  }
}

export function fromDevServerStatus(status: string): AgentState {
  switch (status) {
    case "running":
    case "starting":
      return "work";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

export const STATE_WORD: Record<AgentState, string> = {
  needs: "Needs you",
  work: "Working",
  done: "Done",
  idle: "Idle",
  error: "Error",
  stopped: "Stopped",
  limited: "Limited",
  settled: "Settled",
  paused: "Paused",
  queued: "Queued",
};

/**
 * The limited colour (N-Limited .t-lim, .meter.full): a muted violet, not
 * the meters' bright one, so a full meter reads as stopped, not as busy
 */
export const LIMIT_TEXT_CLASS = "text-[#5B5499] dark:text-[#B9B4E0]";
export const LIMIT_FILL_CLASS = "bg-[#7B75B3] dark:bg-[#8F8AB8]";

// The state colours are the dark page's (modern.css: --needs, --work,
// --meter); on the light page text takes a deeper shade of each
export const STATE_TEXT_CLASS: Record<AgentState, string> = {
  needs: "text-amber-600 dark:text-needs",
  work: "text-emerald-600 dark:text-work",
  done: "text-emerald-700 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  idle: "text-muted-foreground",
  stopped: "text-muted-foreground",
  limited: LIMIT_TEXT_CLASS,
  settled: "text-muted-foreground",
  paused: "text-muted-foreground",
  queued: "text-muted-foreground",
};

/** Badge tile tint: the state colour over a faint wash of itself */
export const STATE_BADGE_CLASS: Record<AgentState, string> = {
  needs: "bg-needs/15 text-amber-600 dark:text-needs",
  work: "bg-work/15 text-emerald-600 dark:text-work",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-red-400/15 text-red-600 dark:text-red-400",
  idle: "bg-secondary text-muted-foreground",
  stopped: "bg-secondary text-muted-foreground",
  limited: `bg-[#8F8AB8]/15 ${LIMIT_TEXT_CLASS}`,
  settled: "bg-secondary text-muted-foreground",
  paused: "bg-secondary text-muted-foreground",
  queued: "bg-secondary text-muted-foreground",
};

/**
 * "just now", "5m ago", "3h ago", "2d ago", then the date. Takes epoch ms or
 * a timestamp string; SQLite's "YYYY-MM-DD HH:MM:SS" has no zone and is UTC.
 * Pass `dateAfterDays: Infinity` to keep counting days instead.
 */
export function timeAgo(
  value: number | string,
  { dateAfterDays = 7 }: { dateAfterDays?: number } = {}
): string {
  const date =
    typeof value === "number"
      ? new Date(value)
      : new Date(/(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : value + "Z");
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < dateAfterDays) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * The short age lists put on the right: "now", "12m", "3h", "2d". Takes
 * epoch ms or a timestamp; SQLite's "YYYY-MM-DD HH:MM:SS" is UTC.
 */
/** A DB time ("2026-10-29 07:21:00", UTC) or ISO string in ms; NaN if bad */
export function dbTimeMs(value: string): number {
  return new Date(
    /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : value.replace(" ", "T") + "Z"
  ).getTime();
}

export function shortAge(value: number | string, now = Date.now()): string {
  const at = typeof value === "number" ? value : dbTimeMs(value);
  if (Number.isNaN(at)) return "";
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A state as a small dot's fill */
export const STATE_DOT_CLASS: Record<AgentState, string> = {
  needs: "bg-needs",
  work: "bg-work",
  done: "bg-emerald-500",
  error: "bg-red-400",
  idle: "bg-muted-foreground/50",
  stopped: "bg-muted-foreground/50",
  limited: LIMIT_FILL_CLASS,
  settled: "bg-muted-foreground/50",
  paused: "bg-muted-foreground/50",
  queued: "bg-muted-foreground/50",
};

/** A state as an icon, where a dot alone would be too quiet */
export const STATE_ICON: Record<AgentState, LucideIcon> = {
  needs: CircleAlert,
  work: Loader,
  done: CircleCheck,
  idle: CircleDot,
  error: CircleSlash,
  stopped: Square,
  limited: Hourglass,
  settled: Moon,
  paused: CirclePause,
  queued: Clock,
};
