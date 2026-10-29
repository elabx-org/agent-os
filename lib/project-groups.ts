/**
 * The Projects page's model (E-Projects): Pinned first, then the user's own
 * groups, then the rest; a colour per project for its letter tile and a
 * status line per row. Pure, so the page, the desktop sidebar and the unit
 * tests share it.
 */

import { shortAge, type AgentState } from "@/lib/agent-state";
import type { Project } from "@/lib/db";

/** PATCH /api/projects/[id] body for the Projects page's own fields */
export interface ProjectPlacement {
  pinned?: boolean;
  /** null or "" takes it out of its group */
  groupName?: string | null;
}

/** A project's tile colour (E-Projects' .pj tiles), stable per project */
export type ProjectTone =
  | "purple"
  | "teal"
  | "blue"
  | "orange"
  | "pink"
  | "green";

export const PROJECT_TONES: readonly ProjectTone[] = [
  "purple",
  "teal",
  "blue",
  "orange",
  "pink",
  "green",
];

/** The same tone for a project everywhere, from its id */
export function projectTone(project: Pick<Project, "id">): ProjectTone {
  // FNV-1a: cheap, and spreads ids that differ only at the end
  let hash = 0x811c9dc5;
  for (let i = 0; i < project.id.length; i++) {
    hash ^= project.id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PROJECT_TONES[(hash >>> 0) % PROJECT_TONES.length];
}

/** What runs in a project, counted the way ProjectList counts it */
export interface ProjectActivity {
  needs: number;
  work: number;
  /** Sessions and background agents, every state */
  agents: number;
  /** The newest session activity, ms since epoch; null if none */
  lastActiveAt: number | null;
}

/**
 * A row's second line: "1 needs you · 1 working" with the leading state's
 * dot, or "Quiet · 2d" (no dot) when nothing runs
 */
export interface ProjectStatusLine {
  state: AgentState | null;
  text: string;
}

export function projectStatusLine(
  activity: ProjectActivity,
  now: number = Date.now()
): ProjectStatusLine {
  const { needs, work, lastActiveAt } = activity;
  if (needs > 0 || work > 0) {
    const parts: string[] = [];
    if (needs > 0) parts.push(`${needs} ${needs === 1 ? "needs" : "need"} you`);
    if (work > 0) parts.push(`${work} working`);
    return { state: needs > 0 ? "needs" : "work", text: parts.join(" · ") };
  }
  if (lastActiveAt == null) return { state: null, text: "Quiet" };
  return { state: null, text: `Quiet · ${shortAge(lastActiveAt, now)}` };
}

/** The Projects column's sort item: the user's order, recent, or by name */
export type ProjectSort = "manual" | "recent" | "name";

export interface ProjectGroup<P> {
  /** "Pinned", a group name, or null for the ungrouped rest */
  name: string | null;
  pinned?: boolean;
  projects: P[];
}

/**
 * Pinned, then each group (in the order its first project sorts), then the
 * ungrouped rest; Uncategorized last and only when it holds something
 * (`activity` says). Empty groups are left out.
 */
export function groupProjects<P extends Project>(
  projects: P[],
  activity: Record<string, ProjectActivity>,
  sort: ProjectSort = "manual"
): ProjectGroup<P>[] {
  const sorted = [...projects].sort(compareBy(sort, activity));
  const pinned: P[] = [];
  const groups = new Map<string, P[]>();
  const rest: P[] = [];
  let uncategorized: P | undefined;
  for (const project of sorted) {
    if (project.is_uncategorized) {
      // Only when it holds something, or it's all there is
      if (activity[project.id]?.agents || projects.length === 1)
        uncategorized = project;
    } else if (project.pinned) pinned.push(project);
    else if (project.group_name?.trim()) {
      const name = project.group_name.trim();
      // A Map keeps the order its first project came in
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(project);
    } else rest.push(project);
  }
  if (uncategorized) rest.push(uncategorized);

  const result: ProjectGroup<P>[] = [];
  if (pinned.length)
    result.push({ name: "Pinned", pinned: true, projects: pinned });
  for (const [name, list] of groups) result.push({ name, projects: list });
  if (rest.length) result.push({ name: null, projects: rest });
  return result;
}

function compareBy<P extends Project>(
  sort: ProjectSort,
  activity: Record<string, ProjectActivity>
): (a: P, b: P) => number {
  const byOrder = (a: P, b: P) => a.sort_order - b.sort_order || byName(a, b);
  const byName = (a: P, b: P) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  switch (sort) {
    case "name":
      return (a, b) => byName(a, b) || a.sort_order - b.sort_order;
    case "recent":
      // Never active sorts after everything that was
      return (a, b) =>
        (activity[b.id]?.lastActiveAt ?? -Infinity) -
          (activity[a.id]?.lastActiveAt ?? -Infinity) || byOrder(a, b);
    default:
      return byOrder;
  }
}

/**
 * The whole order after a drag inside one group: the group's projects take
 * the places they held, in their new order, and every other project stays
 */
export function reorderWithin(order: string[], moved: string[]): string[] {
  const members = new Set(moved);
  let next = 0;
  return order.map((id) => (members.has(id) ? moved[next++] : id));
}
