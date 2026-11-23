/**
 * "Continue a project on another machine": the project is set up there
 * (its name, defaults, instructions and dev server setup) and the chats the
 * user picked follow, one at a time, each by the session move
 * (lib/session-move-types.ts). Nothing leaves the machine it starts on but
 * the chats. Shapes shared by both machines, the hub and the pages; no
 * server imports.
 */

import type { MachineRef } from "./session-move-types";

/** A project as another machine recreates it. Never its hooks or trust */
export interface ProjectCard {
  name: string;
  agentType: string;
  defaultModel: string;
  initialPrompt: string | null;
  instructions: string | null;
  group: string | null;
  devServers: {
    name: string;
    type: string;
    command: string;
    port: number | null;
    portEnvVar: string | null;
  }[];
}

const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const optional = (value: unknown, max: number) =>
  value === null || text(value, max);

export function validCard(value: unknown): value is ProjectCard {
  const c = value as ProjectCard;
  return (
    !!c &&
    text(c.name, 200) &&
    c.name.trim() !== "" &&
    text(c.agentType, 40) &&
    text(c.defaultModel, 120) &&
    optional(c.initialPrompt, 20_000) &&
    optional(c.instructions, 100_000) &&
    optional(c.group, 120) &&
    Array.isArray(c.devServers) &&
    c.devServers.length <= 20 &&
    c.devServers.every(
      (d) =>
        !!d &&
        text(d.name, 200) &&
        text(d.type, 40) &&
        text(d.command, 4000) &&
        (d.port === null ||
          (Number.isInteger(d.port) && d.port > 0 && d.port < 65536)) &&
        optional(d.portEnvVar, 120)
    )
  );
}

/** POST /api/machines/project-move body */
export interface ProjectMoveRequest {
  /** The project on `from`; absent when chats are only being brought back */
  projectId?: string;
  projectName: string;
  from: MachineRef;
  to: MachineRef;
  /** The chats to take, in order */
  sessions: { id: string; name: string }[];
}

export interface ProjectMoveStep {
  kind: "chat" | "project";
  sessionId?: string;
  name: string;
  state: "todo" | "now" | "done" | "failed";
  /** Why it failed, or what the user should know after it moved */
  note?: string;
}

/** GET /api/machines/project-move?id= */
export interface ProjectMoveJob {
  id: string;
  from: MachineRef;
  to: MachineRef;
  fromName: string;
  toName: string;
  projectName: string;
  steps: ProjectMoveStep[];
  state: "running" | "done";
}

/** What a step reads as in the list */
export function projectStepText(step: ProjectMoveStep, toName: string): string {
  if (step.kind === "project") {
    return step.state === "done"
      ? `Project set up on ${toName}`
      : step.state === "failed"
        ? `Project not set up on ${toName}`
        : `Setting the project up on ${toName}`;
  }
  return step.state === "done"
    ? `${step.name} moved`
    : step.state === "failed"
      ? `${step.name} didn't move`
      : step.state === "now"
        ? `Moving ${step.name}`
        : step.name;
}

/** "2 chats moved", "1 chat moved, 1 didn't": the job's last line */
export function projectMoveSummary(job: ProjectMoveJob): string {
  const chats = job.steps.filter((s) => s.kind === "chat");
  const moved = chats.filter((s) => s.state === "done").length;
  const failed = chats.filter((s) => s.state === "failed").length;
  const n = (count: number) => `${count} chat${count === 1 ? "" : "s"}`;
  const project = job.steps.find((s) => s.kind === "project");
  if (chats.length === 0) {
    return project?.state === "done"
      ? `${job.projectName} is on ${job.toName} now`
      : `${job.projectName} couldn't be set up on ${job.toName}`;
  }
  if (failed === 0) return `${n(moved)} moved to ${job.toName}`;
  if (moved === 0) return `${n(failed)} didn't move`;
  return `${n(moved)} moved to ${job.toName}, ${failed} didn't`;
}
