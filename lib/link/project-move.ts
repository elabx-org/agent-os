/**
 * "Continue a project on another machine" (lib/project-move-types.ts), as
 * the hub runs it: the picked chats move one after another, each by the
 * session move (./move.ts), which carries the code and the project's card;
 * a project with no chat to carry it is set up from its remote. A chat
 * that doesn't move starts again where it was, and the rest carry on.
 * Server only; in memory, like the session moves it drives.
 */

import { randomBytes } from "crypto";
import type {
  ProjectCard,
  ProjectMoveJob,
  ProjectMoveRequest,
  ProjectMoveStep,
} from "../project-move-types";
import {
  MoveNotPossible,
  caller,
  moveJob,
  nameOf,
  startMoveAs,
  userHeaders,
} from "./move";

const shared = globalThis as typeof globalThis & {
  __agentosProjectMoves?: Map<string, ProjectMoveJob>;
};
const jobs = (shared.__agentosProjectMoves ??= new Map());

const POLL_MS = 700;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "Something went wrong";

async function moveChat(
  job: ProjectMoveJob,
  step: ProjectMoveStep,
  headers: Record<string, string>
): Promise<void> {
  step.state = "now";
  try {
    const started = startMoveAs(headers, {
      sessionId: step.sessionId!,
      from: job.from,
      to: job.to,
    });
    for (;;) {
      const move = moveJob(started.id);
      if (!move) throw new Error("Lost track of the move");
      if (move.step === "done") {
        step.state = "done";
        const notes = [
          move.warning,
          move.result?.needsTrust
            ? `Claude asks whether to trust its folder on ${job.toName}`
            : null,
          move.result?.fullAccessOff
            ? "full access didn't travel with it"
            : null,
        ].filter(Boolean);
        if (notes.length) step.note = notes.join("; ");
        return;
      }
      if (move.step === "failed") {
        step.state = "failed";
        step.note = [
          move.error ?? "It didn't move",
          move.restored === false ? `it stays paused on ${job.fromName}` : null,
        ]
          .filter(Boolean)
          .join("; ");
        return;
      }
      await sleep(POLL_MS);
    }
  } catch (error) {
    step.state = "failed";
    step.note = text(error);
  }
}

/** No chat carried it: the project from its card and its remote */
async function setUp(
  job: ProjectMoveJob,
  step: ProjectMoveStep,
  projectId: string,
  headers: Record<string, string>
): Promise<void> {
  step.state = "now";
  const call = caller(headers);
  try {
    const source = await (
      await call(
        job.from,
        `/api/projects/${encodeURIComponent(projectId)}/card`,
        { timeoutMs: 20_000 }
      )
    ).json<{
      card: ProjectCard;
      repo: { name: string; remote: string | null } | null;
    }>();
    if (!source.repo) {
      throw new Error(
        "Its folder isn't a git repository, so its files can't go to another machine"
      );
    }
    await call(job.to, "/api/projects/adopt", {
      json: { card: source.card, repo: source.repo },
      // A clone may take a while
      timeoutMs: 30 * 60_000,
    });
    step.state = "done";
  } catch (error) {
    step.state = "failed";
    step.note = text(error);
  }
}

async function run(
  job: ProjectMoveJob,
  projectId: string | undefined,
  headers: Record<string, string>
) {
  const chats = job.steps.filter((s) => s.kind === "chat");
  const project = job.steps.find((s) => s.kind === "project");
  for (const step of chats) await moveChat(job, step, headers);
  if (project) {
    // A chat that arrived brought the code and the project with it
    if (chats.some((s) => s.state === "done")) project.state = "done";
    else if (projectId) await setUp(job, project, projectId, headers);
    else project.state = "failed";
  }
  job.state = "done";
}

/** Starts it; poll projectMoveJob. Throws MoveNotPossible */
export function startProjectMove(
  request: Request,
  body: ProjectMoveRequest
): ProjectMoveJob {
  if (body.from === body.to) {
    throw new MoveNotPossible("It's already on that machine");
  }
  const fromName = nameOf(body.from);
  const toName = nameOf(body.to);
  for (const other of jobs.values()) {
    if (other.state === "running") {
      throw new MoveNotPossible(
        `${other.projectName} is still moving. Wait for it to finish`
      );
    }
  }
  const job: ProjectMoveJob = {
    id: randomBytes(8).toString("hex"),
    from: body.from,
    to: body.to,
    fromName,
    toName,
    projectName: body.projectName,
    steps: [
      ...body.sessions.map(
        (s): ProjectMoveStep => ({
          kind: "chat",
          sessionId: s.id,
          name: s.name,
          state: "todo",
        })
      ),
      // Bringing chats back needs no project: it is still here
      ...(body.projectId
        ? [
            {
              kind: "project",
              name: body.projectName,
              state: "todo",
            } satisfies ProjectMoveStep,
          ]
        : []),
    ],
    state: "running",
  };
  jobs.set(job.id, job);
  run(job, body.projectId, userHeaders(request)).catch((error) => {
    console.error("[project-move]", error);
    for (const step of job.steps) {
      if (step.state === "now" || step.state === "todo") {
        step.state = "failed";
        step.note ??= "Something went wrong while moving it";
      }
    }
    job.state = "done";
  });
  setTimeout(() => jobs.delete(job.id), 60 * 60_000).unref();
  return job;
}

export const projectMoveJob = (id: string): ProjectMoveJob | null =>
  jobs.get(id) ?? null;
