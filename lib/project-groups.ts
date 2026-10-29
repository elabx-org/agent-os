/**
 * The Projects page's model (E-Projects): Pinned first, then the user's own
 * groups, then the rest; a colour per project for its letter tile and a
 * status line per row. Pure, so the page, the desktop sidebar and the unit
 * tests share it. M1b U1b.1 fills the bodies.
 */

import type { AgentState } from "@/lib/agent-state";
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
  void project;
  return "purple";
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
  void now;
  return { state: null, text: activity.agents ? "" : "Quiet" };
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
  void activity;
  void sort;
  return [{ name: null, projects }];
}
