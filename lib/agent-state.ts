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

// The 400s wash out on the light themes, so those get the 600s
export const STATE_TEXT_CLASS: Record<AgentState, string> = {
  needs: "text-amber-600 dark:text-amber-400",
  work: "text-blue-600 dark:text-blue-400",
  done: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  idle: "text-muted-foreground",
  stopped: "text-muted-foreground",
  limited: "text-violet-600 dark:text-violet-300",
  settled: "text-muted-foreground",
  paused: "text-muted-foreground",
  queued: "text-muted-foreground",
};

/** Badge tile tint: the state colour over a faint wash of itself */
export const STATE_BADGE_CLASS: Record<AgentState, string> = {
  needs: "bg-amber-400/15 text-amber-600 dark:text-amber-400",
  work: "bg-blue-400/15 text-blue-600 dark:text-blue-400",
  done: "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-400/15 text-red-600 dark:text-red-400",
  idle: "bg-secondary text-muted-foreground",
  stopped: "bg-secondary text-muted-foreground",
  limited: "bg-violet-400/15 text-violet-600 dark:text-violet-300",
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

/** A state as a small dot's fill */
export const STATE_DOT_CLASS: Record<AgentState, string> = {
  needs: "bg-amber-400",
  work: "bg-blue-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
  idle: "bg-muted-foreground/50",
  stopped: "bg-muted-foreground/50",
  limited: "bg-violet-400",
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
