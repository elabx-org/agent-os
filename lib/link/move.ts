/**
 * The hub's part of "Continue on another machine" (lib/session-move.ts):
 * one job per move, run here because both machines are reachable from the
 * hub (itself, or down a link) and the two files are too large to go
 * through the user's phone. Every call carries the user's own request
 * headers, so each machine's user-only check sees the user. Server only.
 */

import { randomBytes } from "crypto";
import http from "http";
import type { Readable } from "stream";
import {
  MOVE_ID,
  type MachineRef,
  type MoveInCancel,
  type MoveInState,
  type MoveJob,
  type MoveManifest,
  type MoveRequest,
  type MoveStep,
} from "../session-move-types";
import type { MovePlan } from "../repos-dir";
import { HUB_MARKER, MACHINE_HEADER, linkHub, ownSha } from "./server";
import { serverNameOr } from "../server-name";
import { machineById, serverName } from "./store";
import { dropOtherCopies, noteMove } from "../backup/store";

const POLL_MS = 1000;
/** A first clone of a large repository can take a while */
const PREPARE_MS = 20 * 60_000;
/**
 * Longer than the other machine's own git limits, so it is never called
 * off while it is still legitimately working
 */
const IMPORT_MS = 40 * 60_000;
const AFTER_CANCEL_MS = 20 * 60_000;
/** A small call's answer */
const CALL_MS = 150_000;
/** Pausing a session, packing its code */
const FILE_MS = 45 * 60_000;

const shared = globalThis as typeof globalThis & {
  __agentosMoveJobs?: Map<string, MoveJob>;
};
const jobs = (shared.__agentosMoveJobs ??= new Map());

export class MoveNotPossible extends Error {}

/** The machine's name, or why a session can't go to or leave it now */
function nameOf(machine: MachineRef): string {
  if (machine === HUB_MARKER) return serverNameOr(serverName());
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
export function userHeaders(request: Request): Record<string, string> {
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

class StepFailed extends Error {
  constructor(
    message: string,
    /** The HTTP status, 0 when the call never got an answer */
    readonly status = 0
  ) {
    super(message);
  }
  /** Worth asking again: the link dropped or the machine was busy */
  get passing(): boolean {
    return [0, 502, 503, 504].includes(this.status);
  }
}

interface CallInit {
  method?: string;
  json?: unknown;
  /** A body piped through (one of the two files) */
  stream?: Readable;
  /** No limit when a file goes through */
  timeoutMs?: number;
}

interface Answer {
  status: number;
  /** The body as it arrives (a file) */
  stream: http.IncomingMessage;
  json<T>(): Promise<T>;
}

/**
 * Calls a machine's own API as the user: the hub's loopback, down the
 * link for a machine. Plain http, so a long transfer has no client
 * timeout of its own
 */
export function caller(headers: Record<string, string>) {
  const port = Number(process.env.PORT || "3011");
  return (machine: MachineRef, path: string, init: CallInit = {}) =>
    new Promise<Answer>((resolve, reject) => {
      const hub = machine === HUB_MARKER;
      const body =
        init.json === undefined ? null : Buffer.from(JSON.stringify(init.json));
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          method: init.method ?? (body || init.stream ? "POST" : "GET"),
          // Machine ids are checked by the route (m_ and hex): the path
          // is built by the hub alone, never from what a machine sent
          path: hub ? path : `/m/${machine}${path}`,
          headers: {
            ...headers,
            // Whatever machine the user's tab looks at, this one is for the hub
            ...(hub ? { [MACHINE_HEADER]: HUB_MARKER } : {}),
            ...(body
              ? {
                  "content-type": "application/json",
                  "content-length": String(body.length),
                }
              : {}),
            ...(init.stream
              ? { "content-type": "application/octet-stream" }
              : {}),
          },
        },
        (res) => {
          const status = res.statusCode ?? 502;
          const json = async <T>(): Promise<T> => {
            const chunks: Buffer[] = [];
            for await (const chunk of res) chunks.push(chunk as Buffer);
            return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
          };
          if (status >= 200 && status < 300) {
            resolve({ status, stream: res, json });
            return;
          }
          json<{ error?: string }>()
            .catch(() => null)
            .then((failed) =>
              reject(
                new StepFailed(
                  failed?.error && failed.error !== "user_only"
                    ? failed.error
                    : `It stopped with an error (${status})`,
                  status
                )
              )
            );
        }
      );
      if (!init.stream) {
        request.setTimeout(init.timeoutMs ?? CALL_MS, () =>
          request.destroy(new Error("timed out"))
        );
      }
      request.on("error", (error) =>
        reject(new StepFailed(`Couldn't reach it (${error.message})`, 0))
      );
      if (init.stream) {
        init.stream.on("error", (error) => request.destroy(error));
        init.stream.pipe(request);
      } else {
        request.end(body ?? undefined);
      }
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(job: MoveJob, headers: Record<string, string>) {
  const call = caller(headers);
  const { sessionId: id, from, to } = job;
  const step = (next: MoveStep) => {
    job.step = next;
  };
  const sid = encodeURIComponent(id);
  const fromName = job.fromName;
  /** Starts it again where it was; false when that couldn't be confirmed */
  const restore = async (query: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await call(from, `/api/sessions/${sid}/move-out?${query}`, {
          method: "DELETE",
        });
        return true;
      } catch (error) {
        console.error("[move] starting it again:", error);
        if (!(error instanceof StepFailed) || !error.passing) return false;
        await sleep(2000);
      }
    }
    return false;
  };

  step("pausing");
  let manifest: MoveManifest;
  try {
    manifest = await (
      await call(from, `/api/sessions/${sid}/move-out`, {
        method: "POST",
        timeoutMs: FILE_MS,
      })
    ).json<MoveManifest>();
  } catch (error) {
    // A refusal changed nothing; a lost answer may have paused it
    job.restored =
      error instanceof StepFailed && !error.passing
        ? true
        : await restore("pending=1");
    throw error;
  }
  // The id goes into paths on both machines: only the shape the hub expects
  if (
    !manifest ||
    typeof manifest.moveId !== "string" ||
    !MOVE_ID.test(manifest.moveId) ||
    manifest.sessionId !== id
  ) {
    job.restored = await restore("pending=1");
    throw new StepFailed(`${cap(fromName)} answered with something unexpected`);
  }
  const moveId = manifest.moveId;
  const state = async () =>
    (await call(to, `/api/session-moves/${moveId}`)).json<MoveInState>();
  const send = async (res: Answer, kind: "bundle" | "transcript") => {
    await call(to, `/api/session-moves/${moveId}/${kind}`, {
      method: "PUT",
      stream: res.stream,
    });
  };

  // Up to here nothing runs on the other machine: any failure is undone
  try {
    step("preparing");
    await call(to, "/api/session-moves", {
      json: {
        manifest,
        from: { machine: from, name: fromName },
        self: { machine: to, name: job.toName },
      },
    });
    const end = Date.now() + PREPARE_MS;
    let ready: MoveInState;
    let misses = 0;
    for (;;) {
      try {
        ready = await state();
        misses = 0;
      } catch (error) {
        // The link can drop for a moment while it clones
        if (!(error instanceof StepFailed) || !error.passing || ++misses > 30) {
          throw error;
        }
        await sleep(POLL_MS * 2);
        continue;
      }
      if (ready.phase === "ready") break;
      if (ready.phase === "failed") {
        throw new StepFailed(ready.error || `${job.toName} couldn't take it`);
      }
      if (Date.now() > end) throw new StepFailed(`${job.toName} took too long`);
      await sleep(POLL_MS);
    }

    step("code");
    const bundle = await call(from, `/api/sessions/${sid}/move-out/bundle`, {
      json: { moveId, have: ready.have ?? [] },
      timeoutMs: FILE_MS,
    });
    if (bundle.status !== 204) await send(bundle, "bundle");
    else bundle.stream.resume();

    step("conversation");
    await send(
      await call(
        from,
        `/api/sessions/${sid}/move-out/transcript?move=${moveId}`,
        { timeoutMs: FILE_MS }
      ),
      "transcript"
    );
  } catch (error) {
    await call(to, `/api/session-moves/${moveId}`, { method: "DELETE" }).catch(
      () => {}
    );
    job.restored = await restore(`move=${moveId}`);
    throw error;
  }

  // From here the other machine may start it. The copy here is only
  // started again once that machine says it stopped and undid its part
  step("starting");
  let asked: unknown = null;
  try {
    await call(to, `/api/session-moves/${moveId}`, { method: "POST" });
  } catch (error) {
    asked = error;
  }
  const outcome = await settled(job, state, call, moveId, asked);
  if (outcome.kind === "stopped") {
    job.restored = await restore(`move=${moveId}`);
    throw new StepFailed(outcome.error);
  }
  if (outcome.kind === "unsure") {
    // Left paused here, free to resume by hand once the user has looked
    await call(from, `/api/sessions/${sid}/move-out?move=${moveId}&keep=1`, {
      method: "DELETE",
    }).catch(() => {});
    job.restored = false;
    throw new StepFailed(
      `Couldn't confirm whether it started on ${job.toName}. It stays paused on ${fromName}: check ${job.toName} before resuming it`
    );
  }
  job.result = outcome.result;
  // It runs there now: the copy here says where it went
  let marked = false;
  for (let attempt = 0; attempt < 4 && !marked; attempt++) {
    try {
      await call(from, `/api/sessions/${sid}/move-out/finish`, {
        json: { moveId, to: { machine: to, name: job.toName } },
      });
      marked = true;
    } catch (error) {
      console.error("[move] marking it moved:", error);
      await sleep(1500);
    }
  }
  if (!marked) {
    job.warning = `It runs on ${job.toName} now, but the copy on ${fromName} couldn't be marked as moved. Don't resume that copy`;
  }
  // Copies of it kept here from where it was are out of date now, and a
  // take-over of one would make two (lib/backup)
  try {
    // First, so a copy from where it was that is still on its way can't land
    noteMove(
      id,
      from === HUB_MARKER ? null : from,
      to === HUB_MARKER ? null : to
    );
  } catch (error) {
    console.error("[move] noting where it went:", error);
  }
  await dropOtherCopies(id, to === HUB_MARKER ? null : to).catch((error) =>
    console.error("[move] dropping its copies:", error)
  );
  step("done");
}

type Outcome =
  | { kind: "arrived"; result: MoveInState["result"] }
  | { kind: "stopped"; error: string }
  | { kind: "unsure" };

/**
 * Waits for the other machine to say how its import ended. A link that
 * drops for a while is waited out; past the limit it is asked to stop,
 * and only its own answer counts
 */
async function settled(
  job: MoveJob,
  state: () => Promise<MoveInState>,
  call: ReturnType<typeof caller>,
  moveId: string,
  asked: unknown
): Promise<Outcome> {
  const failedText = (s: MoveInState) =>
    s.error || `${job.toName} couldn't take it`;
  let cancelAt = Date.now() + IMPORT_MS;
  const giveUpAt = cancelAt + AFTER_CANCEL_MS;
  let cancelled = false;
  // The import was refused outright: nothing started
  if (asked instanceof StepFailed && !asked.passing) cancelAt = 0;
  for (;;) {
    if (!cancelled && Date.now() > cancelAt) {
      try {
        const res = await (
          await call(to(job), `/api/session-moves/${moveId}`, {
            method: "DELETE",
          })
        ).json<MoveInCancel>();
        cancelled = true;
        if (res.stopped) {
          return {
            kind: "stopped",
            error:
              asked instanceof StepFailed && !asked.passing
                ? asked.message
                : `${job.toName} took too long`,
          };
        }
      } catch (error) {
        // Gone from its memory: it restarted mid-move
        if (error instanceof StepFailed && error.status === 404) {
          return { kind: "unsure" };
        }
      }
    }
    try {
      const now = await state();
      if (now.phase === "done") return { kind: "arrived", result: now.result };
      if (now.phase === "failed") {
        return { kind: "stopped", error: failedText(now) };
      }
      // Still "ready": the call to start it never got there
      if (now.phase === "ready" && asked && !cancelled) cancelAt = 0;
    } catch (error) {
      if (error instanceof StepFailed && error.status === 404) {
        return { kind: "unsure" };
      }
    }
    if (Date.now() > giveUpAt) return { kind: "unsure" };
    await sleep(POLL_MS);
  }
}

const to = (job: MoveJob) => job.to;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Starts a move; poll moveJob. Throws MoveNotPossible */
export function startMove(request: Request, body: MoveRequest): MoveJob {
  if (body.from === body.to) {
    throw new MoveNotPossible("It's already on that machine");
  }
  const fromName = nameOf(body.from);
  const job: MoveJob = {
    id: randomBytes(8).toString("hex"),
    sessionId: body.sessionId,
    from: body.from,
    to: body.to,
    toName: nameOf(body.to),
    fromName,
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
    job.failedAt = job.step;
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

/** Where a session would land on the other machine; null when unknown */
export async function planMove(
  request: Request,
  body: MoveRequest
): Promise<MovePlan | null> {
  const call = caller(userHeaders(request));
  try {
    const repo = await (
      await call(body.from, `/api/sessions/${body.sessionId}/move-out/repo`, {
        timeoutMs: 15_000,
      })
    ).json<{ name: string; remote: string | null }>();
    const plan = await (
      await call(body.to, "/api/session-moves/plan", {
        json: {
          sessionId: body.sessionId,
          name: String(repo.name).slice(0, 300),
          remote: typeof repo.remote === "string" ? repo.remote : null,
        },
        timeoutMs: 15_000,
      })
    ).json<MovePlan>();
    return ["return", "existing", "clone"].includes(plan?.mode) &&
      typeof plan.folder === "string" &&
      typeof plan.reposDir === "string"
      ? {
          mode: plan.mode,
          folder: plan.folder.slice(0, 1024),
          reposDir: plan.reposDir.slice(0, 1024),
        }
      : null;
  } catch {
    return null;
  }
}
