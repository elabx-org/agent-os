import type { Project, Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";

/** How many projects the sidebar lists before "N more" (Desk-Chat) */
export const SIDEBAR_PROJECTS = 5;

/** A session with a live tmux behind it */
export function isLive(
  session: Pick<Session, "id">,
  statuses: Record<string, Pick<SessionStatus, "status">>
): boolean {
  const status = statuses[session.id]?.status;
  return !!status && status !== "dead";
}

/**
 * The sidebar's age on the right of a row: "now", "2m", "3h", "2d". Takes
 * epoch ms or a timestamp; SQLite's "YYYY-MM-DD HH:MM:SS" is UTC.
 */
export function shortAge(value: number | string, now = Date.now()): string {
  const at =
    typeof value === "number"
      ? value
      : new Date(
          /(Z|[+-]\d\d:?\d\d)$/.test(value)
            ? value
            : value.replace(" ", "T") + "Z"
        ).getTime();
  if (Number.isNaN(at)) return "";
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export interface SidebarProject<P> {
  project: P;
  /** Its sessions running in tmux (workers count with their conductor) */
  live: number;
}

/**
 * The sidebar's Projects: pinned first, then in the user's order, without
 * Uncategorized, each with its live-session count
 */
export function sidebarProjects<
  P extends Pick<Project, "id" | "sort_order" | "is_uncategorized"> & {
    pinned?: boolean;
  },
>(
  projects: P[],
  sessions: Pick<Session, "id" | "project_id" | "conductor_session_id">[],
  statuses: Record<string, Pick<SessionStatus, "status">>
): SidebarProject<P>[] {
  const live = new Map<string, number>();
  for (const s of sessions) {
    if (!s.project_id || s.conductor_session_id || !isLive(s, statuses))
      continue;
    live.set(s.project_id, (live.get(s.project_id) ?? 0) + 1);
  }
  return projects
    .filter((p) => !p.is_uncategorized)
    .map((project, index) => ({ project, index }))
    .sort(
      (a, b) =>
        Number(!!b.project.pinned) - Number(!!a.project.pinned) ||
        a.project.sort_order - b.project.sort_order ||
        a.index - b.index
    )
    .map(({ project }) => ({ project, live: live.get(project.id) ?? 0 }));
}

const RAIL_RANK: Record<string, number> = { waiting: 0, running: 1 };

/**
 * The avatar rail's tiles: every live session (not workers), the ones on
 * screen first as they're placed, then what needs you, what's working and
 * the rest, each most recent first
 */
export function railSessions<
  S extends Pick<Session, "id" | "updated_at" | "conductor_session_id">,
>(
  sessions: S[],
  statuses: Record<string, Pick<SessionStatus, "status">>,
  shownIds: readonly string[]
): S[] {
  const rank = (s: S) => {
    const shown = shownIds.indexOf(s.id);
    if (shown >= 0) return shown - shownIds.length;
    return RAIL_RANK[statuses[s.id]?.status ?? ""] ?? 2;
  };
  return sessions
    .filter((s) => !s.conductor_session_id && isLive(s, statuses))
    .sort(
      (a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at)
    );
}
