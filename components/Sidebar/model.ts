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

/** The sidebar's age on the right of a row (one helper for every list) */
export { shortAge } from "@/lib/agent-state";

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
 * The avatar rail's tiles (Desk-Beside): the sessions on screen first as
 * they're placed, then what needs you and what's working, each most recent
 * first. Idle ones and workers stay in the sidebar
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
    .filter(
      (s) =>
        !s.conductor_session_id &&
        isLive(s, statuses) &&
        (shownIds.includes(s.id) || rank(s) < 2)
    )
    .sort(
      (a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at)
    );
}
