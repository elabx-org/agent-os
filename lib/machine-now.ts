/**
 * The other machines' part of Now: from each one's sessions, statuses and
 * projects, what needs you there, what's working and its quiet projects,
 * each tagged with where it lives. Pure, so the tests share it.
 */

import type { Session } from "./db/types";
import { isLimitShown } from "./limits/types";
import { isEnded } from "./settle-types";

/** Where a row lives: a machine's id, or "hub" for this server */
export interface MachineTag {
  target: string;
  name: string;
  kind: "mac" | "server";
}

/** Only what the model reads of a status and a project */
export interface StatusLike {
  status: string;
  lastLine?: string;
}

export interface ProjectLike {
  id: string;
  name: string;
  is_uncategorized?: boolean | number;
  sort_order?: number;
}

/** Only what the model reads of a background agent */
export interface AgentLike {
  id: string;
  name: string;
  cwd: string;
  state: string;
  startedAt?: number;
  /** Set when it's a session sent to the background: listed as that session */
  agentOsSessionId?: string;
}

export interface MachineSource {
  tag: MachineTag;
  sessions: Session[];
  statuses: Record<string, StatusLike>;
  projects: ProjectLike[];
  agents?: AgentLike[];
}

export interface TaggedSession {
  tag: MachineTag;
  session: Session;
  /** The pane's last line, for a working row */
  line?: string;
  /** The session's project, by name */
  project?: string;
}

export interface TaggedProject {
  tag: MachineTag;
  project: ProjectLike;
  /** Its sessions' latest activity, "" when none */
  lastUsed: string;
}

export interface TaggedAgent {
  tag: MachineTag;
  agent: AgentLike;
}

export interface OtherMachinesNow {
  needs: TaggedSession[];
  working: TaggedSession[];
  quiet: TaggedProject[];
  /** Background agents waiting on you there */
  blocked: TaggedAgent[];
  /** Background agents working there */
  agents: TaggedAgent[];
  /** Idle sessions outside every project there, most recent first */
  loose: TaggedSession[];
}

export const EMPTY_OTHERS: OtherMachinesNow = {
  needs: [],
  working: [],
  quiet: [],
  blocked: [],
  agents: [],
  loose: [],
};

/** What needs you on the other machines: sessions and blocked agents */
export const othersNeedCount = (others: OtherMachinesNow) =>
  others.needs.length + others.blocked.length;

/** What's working on the other machines: sessions and agents */
export const othersWorkingCount = (others: OtherMachinesNow) =>
  others.working.length + others.agents.length;

const newestFirst = (a: TaggedSession, b: TaggedSession) =>
  b.session.updated_at.localeCompare(a.session.updated_at);

/** Each project's latest session activity */
export function lastUsedByProject(
  sessions: readonly Pick<Session, "project_id" | "updated_at">[]
): Map<string, string> {
  const lastUsed = new Map<string, string>();
  for (const s of sessions) {
    if (!s.project_id) continue;
    const seen = lastUsed.get(s.project_id);
    if (!seen || s.updated_at > seen) lastUsed.set(s.project_id, s.updated_at);
  }
  return lastUsed;
}

/**
 * Needs you and Working as on this server (useNeedsYou, useNowItems):
 * workers show inside their conductor, a limited session is under Limited
 * (left out here), a handed-off or settled one never works
 */
export function otherMachinesNow(
  sources: readonly MachineSource[],
  now: number = Date.now()
): OtherMachinesNow {
  const needs: TaggedSession[] = [];
  const working: TaggedSession[] = [];
  const quiet: TaggedProject[] = [];
  const blocked: TaggedAgent[] = [];
  const agents: TaggedAgent[] = [];
  const loose: TaggedSession[] = [];
  for (const source of sources) {
    const { tag, sessions, statuses, projects } = source;
    // Uncategorized isn't a project to name
    const names = new Map(
      projects.filter((p) => !p.is_uncategorized).map((p) => [p.id, p.name])
    );
    const uncategorized = new Set(
      projects.filter((p) => p.is_uncategorized).map((p) => p.id)
    );
    const busy = new Set<string>();
    for (const session of sessions) {
      if (session.conductor_session_id || isEnded(session)) continue;
      if (isLimitShown(session, now)) {
        if (session.project_id) busy.add(session.project_id);
        continue;
      }
      const status = statuses[session.id];
      const row: TaggedSession = {
        tag,
        session,
        line: status?.lastLine?.trim() || undefined,
        project: session.project_id ? names.get(session.project_id) : undefined,
      };
      if (status?.status === "waiting") needs.push(row);
      else if (status?.status === "running") working.push(row);
      else {
        // Idle and outside every project: no quiet project lists it
        if (!session.project_id || uncategorized.has(session.project_id))
          loose.push(row);
        continue;
      }
      if (session.project_id) busy.add(session.project_id);
    }
    for (const agent of source.agents ?? []) {
      // A session sent to the background is listed as that session
      if (agent.agentOsSessionId) continue;
      if (agent.state === "blocked") blocked.push({ tag, agent });
      else if (agent.state === "working") agents.push({ tag, agent });
    }
    const lastUsed = lastUsedByProject(sessions);
    for (const project of projects) {
      if (project.is_uncategorized || busy.has(project.id)) continue;
      quiet.push({ tag, project, lastUsed: lastUsed.get(project.id) ?? "" });
    }
  }
  needs.sort(newestFirst);
  working.sort(newestFirst);
  quiet.sort(
    (a, b) =>
      b.lastUsed.localeCompare(a.lastUsed) ||
      (a.project.sort_order ?? 0) - (b.project.sort_order ?? 0)
  );
  loose.sort(newestFirst);
  const newestAgent = (a: TaggedAgent, b: TaggedAgent) =>
    (b.agent.startedAt ?? 0) - (a.agent.startedAt ?? 0);
  blocked.sort(newestAgent);
  agents.sort(newestAgent);
  return { needs, working, quiet, blocked, agents, loose };
}

/** A quiet row on Now: this server's project, or another machine's */
export type QuietEntry<P> =
  | { kind: "local"; project: P }
  | { kind: "other"; item: TaggedProject };

/**
 * This server's quiet projects (already in order) with the other machines',
 * by last use: this server's keep their order among themselves
 */
export function mergeQuiet<P extends { id: string }>(
  local: readonly P[],
  localLastUsed: ReadonlyMap<string, string>,
  others: readonly TaggedProject[]
): QuietEntry<P>[] {
  const out: QuietEntry<P>[] = [];
  let i = 0;
  let j = 0;
  while (i < local.length || j < others.length) {
    const mine = local[i];
    const theirs = others[j];
    if (
      mine &&
      (!theirs || (localLastUsed.get(mine.id) ?? "") >= theirs.lastUsed)
    ) {
      out.push({ kind: "local", project: mine });
      i++;
    } else {
      out.push({ kind: "other", item: theirs });
      j++;
    }
  }
  return out;
}
