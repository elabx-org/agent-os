import { useMemo } from "react";
import { useBackgroundAgentsByProject } from "@/components/BackgroundAgents";
import { useNeedsYou } from "@/hooks/useNeedsYou";
import { useRunningSubagents } from "@/hooks/useRunningSubagents";
import type { SessionSubagent } from "@/hooks/useRunningSubagents";
import { displayTitle, useSessionTitles } from "@/hooks/useSessionTitles";
import { agentName } from "@/components/a/Avatar";
import { useDevServersQuery } from "@/data/dev-servers";
import { useProjectsQuery } from "@/data/projects";
import type { SessionStatus } from "@/components/views/types";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { DevServer, Session } from "@/lib/db";
import type { ProjectWithRepositories } from "@/lib/projects";
import { handedOffLine, withoutPaused } from "@/lib/paused";
import { isPaused } from "@/lib/handoff-types";
import { sortQuietSessions } from "./now-summary";
import { limitedSessions } from "@/components/Chat/limited-model";
import { useLimitClock } from "@/hooks/useSessionLimit";
import { usePendingRemoval } from "@/stores/pendingRemoval";
import {
  doneTodayItems,
  settledTodayList,
  withPendingSettles,
  type DoneItem,
} from "./settle-model";

export interface AgentGroup {
  key: string;
  projectName?: string;
  agents: BackgroundAgent[];
}

/** A finished piece of work for the "Done today" rows: a settled session */
export type DoneTodayItem = DoneItem;

export interface NowItems {
  /** Waiting sessions plus blocked agents: the hero's number */
  needsCount: number;
  waiting: Session[];
  blocked: AgentGroup[];
  working: {
    subagents: (SessionSubagent & { parent: Session })[];
    sessions: Session[];
    agents: { agent: BackgroundAgent; projectName?: string }[];
    devServers: DevServer[];
  };
  workingCount: number;
  /** Projects with nothing waiting or working, most recently used first */
  quiet: ProjectWithRepositories[];
  /** Idle sessions outside every project, most recent first, the paused
      (handed-off) then settled ones last: no quiet project lists them.
      Those settled today are under Settled instead */
  loose: Session[];
  /** Agents outside every project that are neither blocked nor working */
  elsewhere: BackgroundAgent[];
  /**
   * At a usage limit that hasn't reset, or resuming at the reset until it
   * goes (limitView): oldest limit first
   */
  limited: Session[];
  /** Settled today, swiped ones at once, newest first */
  settled: Session[];
  /** The settled ones as "Done today" rows (wide), hidden while empty */
  doneToday: DoneTodayItem[];
  titles: Record<string, string>;
  /** Paused sessions' sublines by id: "Handed off to Codex" */
  handoffs: Record<string, string>;
}

const EMPTY_PROJECTS: ProjectWithRepositories[] = [];
const EMPTY_SERVERS: DevServer[] = [];

/**
 * The Now home's model: what needs you, what's working (sessions, their
 * subagents, background agents, dev servers) and the projects left quiet.
 */
export function useNowItems(
  listed: Session[],
  statuses: Record<string, SessionStatus>
): NowItems {
  // A swiped session is settled at once; the settle goes after its Undo
  const { settles } = usePendingRemoval();
  const sessions = useMemo(
    () => withPendingSettles(listed, settles),
    [listed, settles]
  );
  const projects = useProjectsQuery().data ?? EMPTY_PROJECTS;
  const servers = useDevServersQuery().data ?? EMPTY_SERVERS;
  // A paused (handed-off) session never needs you nor works: its tmux ended
  const active = useMemo(() => withoutPaused(sessions), [sessions]);
  // What needs you is defined once, so the hero matches the column badge
  const needs = useNeedsYou(active, statuses);
  const { agents, waiting } = needs;
  const agentsByProject = useBackgroundAgentsByProject(projects);

  // Limited until the reset passes: the clock moves on then
  const clock = useLimitClock(sessions.map((s) => s.limited_until));
  const limited = useMemo(
    () =>
      limitedSessions(
        active.filter((s) => !s.conductor_session_id),
        clock
      ),
    [active, clock]
  );
  const limitedIds = useMemo(
    () => new Set(limited.map((s) => s.id)),
    [limited]
  );

  // Workers show inside their conductor's session, not on their own; a
  // limited one is under Limited, not Working
  const running = useMemo(
    () =>
      active
        .filter(
          (s) =>
            !s.conductor_session_id &&
            !limitedIds.has(s.id) &&
            statuses[s.id]?.status === "running"
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [active, statuses, limitedIds]
  );

  // Only sessions that are doing something can have subagents running
  const live = useMemo(
    () => [...waiting, ...running, ...limited].map((s) => s.id),
    [waiting, running, limited]
  );
  const subagents = useRunningSubagents(live);
  const settled = useMemo(
    () => settledTodayList(sessions, Date.now()),
    [sessions]
  );
  const titles = useSessionTitles([...live, ...settled.map((s) => s.id)]);

  // The by-project map is new each render, so the rest isn't memoised
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const agentProject = new Map<string, string>();
  for (const [id, list] of Object.entries(agentsByProject))
    for (const agent of list) agentProject.set(agent.id, id);

  const busy = new Set<string>();
  const mark = (id: string | null | undefined) => {
    if (id) busy.add(id);
  };

  // Blocked agents, one group per project; those outside any project last
  const groups = new Map<string, AgentGroup>();
  const workingAgents: NowItems["working"]["agents"] = [];
  const elsewhere: BackgroundAgent[] = [];
  for (const agent of agents) {
    const id = agentProject.get(agent.id);
    if (agent.state === "blocked") {
      const key = id ?? "";
      if (!groups.has(key))
        groups.set(key, {
          key,
          projectName: id ? projectName.get(id) : undefined,
          agents: [],
        });
      groups.get(key)!.agents.push(agent);
      mark(id);
    } else if (agent.state === "working") {
      workingAgents.push({
        agent,
        projectName: id ? projectName.get(id) : undefined,
      });
      mark(id);
    } else if (!id) {
      elsewhere.push(agent);
    }
  }
  const blocked = [...groups.values()].sort(
    (a, b) => Number(!a.key) - Number(!b.key)
  );

  const byId = new Map([...waiting, ...running].map((s) => [s.id, s]));
  const runningSubagents = subagents.flatMap((agent) => {
    const parent = byId.get(agent.sessionId);
    return agent.status === "running" && parent ? [{ ...agent, parent }] : [];
  });
  const devServers = servers.filter(
    (s) => s.status === "running" || s.status === "starting"
  );

  for (const s of [...waiting, ...running, ...limited]) mark(s.project_id);
  for (const s of devServers) mark(s.project_id);

  // Quiet: most recently used first, by their sessions' last activity
  const lastUsed = new Map<string, string>();
  for (const s of sessions) {
    if (!s.project_id) continue;
    const seen = lastUsed.get(s.project_id);
    if (!seen || s.updated_at > seen) lastUsed.set(s.project_id, s.updated_at);
  }
  const quiet = projects
    .filter((p) => !p.is_uncategorized && !busy.has(p.id))
    .sort(
      (a, b) =>
        (lastUsed.get(b.id) ?? "").localeCompare(lastUsed.get(a.id) ?? "") ||
        a.sort_order - b.sort_order
    );

  const uncategorized = new Set(
    projects.filter((p) => p.is_uncategorized).map((p) => p.id)
  );
  // Those settled today are under Settled instead
  const settledIds = new Set(settled.map((s) => s.id));
  const loose = sortQuietSessions(
    sessions.filter(
      (s) =>
        !s.conductor_session_id &&
        !byId.has(s.id) &&
        !limitedIds.has(s.id) &&
        !settledIds.has(s.id) &&
        (!s.project_id || uncategorized.has(s.project_id))
    )
  );
  const handoffs: Record<string, string> = {};
  for (const s of sessions)
    if (isPaused(s)) handoffs[s.id] = handedOffLine(s, sessions, agentName);

  return {
    needsCount: needs.count,
    waiting,
    blocked,
    working: {
      subagents: runningSubagents,
      sessions: running,
      agents: workingAgents,
      devServers,
    },
    workingCount:
      runningSubagents.length +
      running.length +
      workingAgents.length +
      devServers.length,
    quiet,
    loose,
    elsewhere,
    limited,
    settled,
    doneToday: doneTodayItems(settled, (s) => displayTitle(s, titles).title),
    titles,
    handoffs,
  };
}
