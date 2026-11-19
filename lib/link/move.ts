/**
 * The hub's part of "Continue on another machine" (lib/session-move.ts):
 * one job per move, run here because both machines are reachable from the
 * hub (itself, or down a link) and the two files are too large to go
 * through the user's phone. Every call carries the user's own request
 * headers, so each machine's user-only check sees the user. Server only.
 */

import { randomBytes } from "crypto";
import type {
  MachineRef,
  MoveInState,
  MoveJob,
  MoveManifest,
  MoveRequest,
  MoveStep,
} from "../session-move-types";
import { HUB_MARKER, MACHINE_HEADER, linkHub, ownSha } from "./server";
import { machineById } from "./store";

const HUB_NAME = "the server";
const POLL_MS = 1000;
/** A first clone of a large repository can take a while */
const PREPARE_MS = 20 * 60_000;
const IMPORT_MS = 10 * 60_000;

const shared = globalThis as typeof globalThis & {
  __agentosMoveJobs?: Map<string, MoveJob>;
};
const jobs = (shared.__agentosMoveJobs ??= new Map());

export class MoveNotPossible extends Error {}

/** The machine's name, or why a session can't go to or leave it now */
function nameOf(machine: MachineRef): string {
  if (machine === HUB_MARKER) return HUB_NAME;
  const row = machineById(machine);
  if (!row || row.status !== "approved") {
    throw new MoveNotPossible("No such machine");
  }
  if (linkHub().presence(machine) !== "online") {
    throw new MoveNotPossible(`${row.name} is offline`);
  }
  // Unknown on either side (a copy that isn't a git checkout) is let
  // through: a machine without these routes fails the first step, and the
  // session starts again where it was
  const mine = ownSha();
  if (row.sha && mine && row.sha !== mine) {
    throw new MoveNotPossible(
      `${row.name} needs the same AgentOS version as this server first; it updates itself shortly after it connects`
    );
  }
  return row.name;
}

/** What makes a call the user's on either machine */
function userHeaders(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [
    "cookie",
    "origin",
    "sec-fetch-site",
    "x-forwarded-proto",
  ]) {
    const value = request.headers.get(name);
    if (value) out[name] = value;
  }
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) out["x-forwarded-host"] = host;
  return out;
}

class StepFailed extends Error {}

function caller(headers: Record<string, string>) {
  const base = `http://127.0.0.1:${process.env.PORT || "3011"}`;
  return async (machine: MachineRef, path: string, init: RequestInit = {}) => {
    const hub = machine === HUB_MARKER;
    const res = await fetch(hub ? base + path : `${base}/m/${machine}${path}`, {
      ...init,
      headers: {
        ...headers,
        // Whatever machine the user's tab looks at, this one is for the hub
        ...(hub ? { [MACHINE_HEADER]: HUB_MARKER } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new StepFailed(
        body?.error && body.error !== "user_only"
          ? body.error
          : `It stopped with an error (${res.status})`
      );
    }
    return res;
  };
}

const JSON_HEADERS = { "content-type": "application/json" };
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: JSON_HEADERS,
  body: JSON.stringify(body),
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(job: MoveJob, headers: Record<string, string>) {
  const call = caller(headers);
  const { sessionId: id, from, to } = job;
  const step = (next: MoveStep) => {
    job.step = next;
  };
  const fromName = nameOf(from);
  const until = async (
    phase: MoveInState["phase"],
    moveId: string,
    limit: number
  ): Promise<MoveInState> => {
    const end = Date.now() + limit;
    for (;;) {
      const state = (await (
        await call(to, `/api/session-moves/${moveId}`)
      ).json()) as MoveInState;
      if (state.phase === phase) return state;
      if (state.phase === "failed") {
        throw new StepFailed(state.error || `${job.toName} couldn't take it`);
      }
      if (Date.now() > end) {
        throw new StepFailed(`${job.toName} took too long`);
      }
      await sleep(POLL_MS);
    }
  };
  const send = async (
    res: Response,
    kind: "bundle" | "transcript",
    moveId: string
  ) => {
    await call(to, `/api/session-moves/${moveId}/${kind}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: res.body,
      duplex: "half",
    } as RequestInit);
  };

  step("pausing");
  const manifest = (await (
    await call(from, `/api/sessions/${id}/move-out`, { method: "POST" })
  ).json()) as MoveManifest;
  const moveId = manifest.moveId;
  let arrived = false;
  try {
    step("preparing");
    await call(
      to,
      "/api/session-moves",
      post({
        manifest,
        from: { machine: from, name: fromName },
        self: { machine: to, name: job.toName },
      })
    );
    const ready = await until("ready", moveId, PREPARE_MS);

    step("code");
    const bundle = await call(
      from,
      `/api/sessions/${id}/move-out/bundle`,
      post({ moveId, have: ready.have ?? [] })
    );
    if (bundle.status !== 204) await send(bundle, "bundle", moveId);

    step("conversation");
    await send(
      await call(
        from,
        `/api/sessions/${id}/move-out/transcript?move=${moveId}`
      ),
      "transcript",
      moveId
    );

    step("starting");
    await call(to, `/api/session-moves/${moveId}`, { method: "POST" });
    job.result = (await until("done", moveId, IMPORT_MS)).result;
    arrived = true;
    // It runs there now; a row that can't be marked stays paused here
    await call(
      from,
      `/api/sessions/${id}/move-out/finish`,
      post({ moveId, to: { machine: to, name: job.toName } })
    ).catch((error) => console.error("[move] marking it moved:", error));
    step("done");
  } catch (error) {
    if (arrived) throw error;
    await call(to, `/api/session-moves/${moveId}`, { method: "DELETE" }).catch(
      () => {}
    );
    await call(from, `/api/sessions/${id}/move-out?move=${moveId}`, {
      method: "DELETE",
    }).catch((e) => console.error("[move] starting it again:", e));
    throw error;
  }
}

/** Starts a move; poll moveJob. Throws MoveNotPossible */
export function startMove(request: Request, body: MoveRequest): MoveJob {
  if (body.from === body.to) {
    throw new MoveNotPossible("It's already on that machine");
  }
  nameOf(body.from);
  const job: MoveJob = {
    id: randomBytes(8).toString("hex"),
    sessionId: body.sessionId,
    from: body.from,
    to: body.to,
    toName: nameOf(body.to),
    step: "pausing",
  };
  for (const other of jobs.values()) {
    if (
      other.sessionId === job.sessionId &&
      other.step !== "done" &&
      other.step !== "failed"
    ) {
      throw new MoveNotPossible("It's already moving");
    }
  }
  jobs.set(job.id, job);
  run(job, userHeaders(request)).catch((error) => {
    console.error("[move]", error);
    job.step = "failed";
    job.error =
      error instanceof StepFailed || error instanceof MoveNotPossible
        ? error.message
        : "Something went wrong while moving it";
  });
  setTimeout(() => jobs.delete(job.id), 60 * 60_000).unref();
  return job;
}

export const moveJob = (id: string): MoveJob | null => jobs.get(id) ?? null;
