/**
 * The side that asks: a chat on this server hands a job to a linked
 * machine. The chat's code goes first (its commit and a snapshot of its
 * unsaved files, as a git bundle of what the machine lacks), then the
 * machine runs the job in a folder of its own (lib/jobs/runner.ts) and this
 * side follows it until it ends. One job at a time per machine; the rest
 * wait their turn. A machine takes jobs only while the user's switch for it
 * ("sessions on this server may use it") is on. Hub only. Server only.
 */

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { uploader } from "../backup/hub-send";
import { here } from "../backup/peer";
import { getDb, queries, type Session } from "../db";
import { isMachineMode } from "../link/machine";
import { CAP_JOBS } from "../link/protocol";
import { linkHub, machinesOn } from "../link/server";
import {
  listMachines,
  machineById,
  machineCaps,
  type MachineRow,
} from "../link/store";
import { moveRepoOf, packBundle } from "../session-move";
import { parseStartedBy } from "../session-started-by";
import { sessionCwd } from "../transcript-locate";
import { git, toplevel } from "../turns-git";
import { snapshotForMove } from "../worktree-move-git";
import {
  changedOf,
  codeOf,
  insertJob,
  jobRow,
  jobsIn,
  newJobId,
  recentJobs,
  updateJob,
  type JobRow,
} from "./store";
import {
  JOB_ID,
  JOB_REFUSALS,
  PATCH_MAX,
  QUEUE_WAIT_MS,
  TASK_MAX,
  TITLE_MAX,
  cleanReport,
  cleanSpace,
  isOver,
  type Job,
  type JobCode,
  type JobSpace,
  type JobVia,
} from "./types";

export class JobRefused extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const home = () =>
  process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
const patchFile = (id: string) => path.join(home(), "jobs", `${id}.patch`);
const refsOf = (id: string) => `refs/agent-os/jobs/${id}`;
const QUEUE_MAX = 10;
const ROW_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const shared = globalThis as typeof globalThis & {
  __agentosJobs?: {
    /** Jobs whose code is on its way right now */
    sending: Set<string>;
    working: boolean;
    started: boolean;
  };
};
const state = () =>
  (shared.__agentosJobs ??= {
    sending: new Set(),
    working: false,
    started: false,
  });

const getSession = (id: string) =>
  (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;

const online = (machine: MachineRow) =>
  linkHub().presence(machine.id) === "online";

/** By id, by name, or by the start of a name when only one fits */
export function findMachine(wanted: string): MachineRow | null {
  const all = listMachines().filter((m) => m.status === "approved");
  const w = wanted.trim().replace(/^@/, "").toLowerCase();
  if (!w) return null;
  const byId = all.find((m) => m.id === w);
  if (byId) return byId;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const exact = all.filter((m) => squash(m.name) === squash(w));
  if (exact.length === 1) return exact[0];
  const starts = all.filter(
    (m) =>
      squash(m.name).startsWith(squash(w)) || squash(m.name).includes(squash(w))
  );
  return starts.length === 1 ? starts[0] : null;
}

/** Whether this machine may be given a job now, and why not */
export function whyNotJob(machine: MachineRow): string | null {
  if (machine.agents !== 1) return JOB_REFUSALS.agents_off(machine.name);
  if (!online(machine)) return JOB_REFUSALS.offline(machine.name);
  if (!machineCaps(machine).includes(CAP_JOBS)) {
    return JOB_REFUSALS.old(machine.name);
  }
  return null;
}

function toJob(row: JobRow, ahead = 0): Job {
  const machine = machineById(row.machine_id);
  const file = patchFile(row.id);
  return {
    id: row.id,
    machineId: row.machine_id,
    machineName: machine?.name ?? "a machine no longer linked",
    sessionId: row.origin_session,
    sessionName: row.origin_name,
    projectId: row.project_id,
    title: row.title,
    task: row.task,
    state: row.state,
    step: row.step,
    question: row.question,
    jobSession: row.job_session,
    code: codeOf(row),
    result: row.result,
    changed: changedOf(row),
    patch: row.state === "done" && fs.existsSync(file) ? file : null,
    error: row.error,
    via: row.via ?? "chat",
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ahead,
  };
}

/** How many jobs stand before each waiting one on its machine */
function aheadOf(): Map<string, number> {
  const out = new Map<string, number>();
  const count = new Map<string, number>();
  for (const row of jobsIn("sent", ["sending", "running", "waiting"])) {
    count.set(row.machine_id, (count.get(row.machine_id) ?? 0) + 1);
  }
  for (const row of jobsIn("sent", ["queued"])) {
    const n = count.get(row.machine_id) ?? 0;
    out.set(row.id, n);
    count.set(row.machine_id, n + 1);
  }
  return out;
}

export function jobView(id: string): Job | null {
  const row = JOB_ID.test(id) ? jobRow(id, "sent") : null;
  return row ? toJob(row, aheadOf().get(row.id) ?? 0) : null;
}

export interface JobsMachine {
  id: string;
  name: string;
  online: boolean;
  /** Why it can't be given a job now; null when it can */
  blocked: string | null;
}

export interface JobsView {
  here: string;
  machines: JobsMachine[];
  jobs: Job[];
}

export function jobsView(filter: {
  session?: string;
  machine?: string;
  limit?: number;
}): JobsView {
  if (isMachineMode() || !machinesOn()) {
    return { here: here().name, machines: [], jobs: [] };
  }
  const ahead = aheadOf();
  return {
    here: here().name,
    machines: listMachines()
      .filter((m) => m.status === "approved")
      .map((m) => ({
        id: m.id,
        name: m.name,
        online: online(m),
        blocked: whyNotJob(m),
      })),
    jobs: recentJobs("sent", filter).map((row) =>
      toJob(row, ahead.get(row.id) ?? 0)
    ),
  };
}

export interface NewJob {
  /** The chat that asks */
  sessionId: string;
  machine: string;
  title: string;
  task: string;
  via: JobVia;
}

export function createJob(input: NewJob): Job {
  if (isMachineMode()) throw new JobRefused(JOB_REFUSALS.not_here, 409);
  const session = getSession(input.sessionId);
  if (!session) throw new JobRefused(JOB_REFUSALS.no_session, 403);
  // A session that a session elsewhere started (a job's own, or one a job
  // started here): were it to send jobs, they could keep starting each other
  const by = parseStartedBy(session.started_by);
  if (by) {
    throw new JobRefused(
      by.job ? JOB_REFUSALS.from_job : JOB_REFUSALS.from_started,
      403
    );
  }
  const title = input.title.trim().slice(0, TITLE_MAX);
  const task = input.task.trim().slice(0, TASK_MAX);
  if (!title || !task) throw new JobRefused(JOB_REFUSALS.bad);
  const machine = machinesOn() ? findMachine(input.machine) : null;
  if (!machine) throw new JobRefused(JOB_REFUSALS.no_machine, 404);
  const no = whyNotJob(machine);
  if (no) throw new JobRefused(no, 409);
  const open = recentJobs("sent", { session: session.id, limit: 200 }).filter(
    (row) => !isOver(row.state)
  );
  if (open.length >= QUEUE_MAX)
    throw new JobRefused(JOB_REFUSALS.too_many, 429);
  const id = newJobId();
  insertJob({
    id,
    role: "sent",
    machine_id: machine.id,
    origin_session: session.id,
    origin_name: session.name,
    project_id: session.project_id ?? null,
    title,
    task,
    state: "queued",
    via: input.via,
  });
  void pump();
  return jobView(id)!;
}

/** The same job once more: the user's, from the job's card */
export function runAgain(id: string): Job {
  const row = JOB_ID.test(id) ? jobRow(id, "sent") : null;
  if (!row?.origin_session) throw new JobRefused("That job is gone", 404);
  return createJob({
    sessionId: row.origin_session,
    machine: row.machine_id,
    title: row.title,
    task: row.task,
    via: "again",
  });
}

interface Call {
  json<T>(method: string, path: string, body?: unknown): Promise<T>;
  raw(
    method: string,
    path: string,
    body?: Buffer | fs.ReadStream,
    length?: number,
    /** The most of its answer that is read (a patch is larger than a report) */
    maxBytes?: number
  ): Promise<{ status: number; body: Buffer }>;
}

/** A machine's answer to anything but a patch */
const ANSWER_MAX = 1024 * 1024;
/** A machine that says nothing for this long isn't waited for */
const ANSWER_IDLE_MS = 90_000;

/** This server's own calls to a machine's job inbox */
function caller(machineId: string): Call {
  const { upload, seen } = uploader(machineId);
  const raw: Call["raw"] = async (
    method,
    pathname,
    body,
    length,
    maxBytes = ANSWER_MAX
  ) => {
    const answer = await upload(
      {
        method,
        path: `/api/link/inbox/job${pathname}`,
        headers:
          body === undefined
            ? {}
            : {
                "content-type": Buffer.isBuffer(body)
                  ? "application/json"
                  : "application/octet-stream",
                "content-length": String(
                  Buffer.isBuffer(body) ? body.length : (length ?? 0)
                ),
              },
        body: body ?? null,
      },
      { maxBytes, idleMs: ANSWER_IDLE_MS }
    );
    return { status: answer.status, body: answer.body };
  };
  return {
    raw,
    async json<T>(method: string, pathname: string, body?: unknown) {
      const answer = await raw(
        method,
        pathname,
        body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      );
      if (answer.status !== 200) {
        const error = new Error(
          seen.error ?? `The machine answered ${answer.status}`
        ) as Error & { status?: number };
        error.status = answer.status;
        throw error;
      }
      try {
        return JSON.parse(answer.body.toString("utf8")) as T;
      } catch {
        throw new Error("The machine's answer couldn't be read");
      }
    },
  };
}

function failed(id: string, error: unknown): void {
  console.error("[jobs]", id, error);
  updateJob(
    id,
    "sent",
    {
      state: "failed",
      step: null,
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "It couldn't be sent",
      ended_at: Date.now(),
    },
    ["queued", "sending", "running", "waiting"]
  );
}

/** Sends one job: its code, then the word to start */
async function send(row: JobRow): Promise<void> {
  const machine = machineById(row.machine_id);
  const no = machine ? whyNotJob(machine) : JOB_REFUSALS.no_machine;
  if (!machine || no) return failed(row.id, new Error(no ?? "No machine"));
  const session = row.origin_session ? getSession(row.origin_session) : null;
  const call = caller(machine.id);
  const id = row.id;
  let top: string | null = null;
  let bundle: string | null = null;
  // Stopped while it was being sent: nothing more goes, and what the
  // machine got so far is taken back (below)
  const wanted = () => {
    if (jobRow(id, "sent")?.state !== "sending") throw new Error("Stopped");
  };
  try {
    const began = updateJob(
      id,
      "sent",
      {
        state: "sending",
        step: `Copying the code to ${machine.name}`,
        started_at: Date.now(),
      },
      ["queued"]
    );
    if (!began) return;
    const cwd = session ? sessionCwd(session) : null;
    top = cwd && fs.existsSync(cwd) ? await toplevel(cwd) : null;
    let code: JobCode | null = null;
    let body: Record<string, unknown> = {
      title: row.title,
      task: row.task,
      origin: {
        session: row.origin_session,
        name: row.origin_name,
        from: here().name,
      },
      repo: null,
    };
    const refs: string[] = [];
    if (session && cwd && top) {
      const head = (await git(["rev-parse", "HEAD"], { cwd: top })).trim();
      const snapshot = await snapshotForMove(cwd, id, {
        ref: `${refsOf(id)}/snap`,
        label: `job-${id}`,
      });
      await git(["update-ref", `${refsOf(id)}/head`, head], { cwd: top });
      refs.push(`${refsOf(id)}/head`);
      const unsaved = snapshot.paths.length;
      if (unsaved > 0) refs.push(snapshot.ref);
      const repo = await moveRepoOf(session);
      code = { head, unsaved, skipped: snapshot.skipped.length };
      body = {
        ...body,
        repo: {
          name: repo?.name ?? path.basename(top),
          remote: repo?.remote ?? null,
          subdir: path.relative(top, fs.realpathSync(cwd)),
        },
        head,
        snapshot:
          unsaved > 0
            ? {
                commit: snapshot.commit,
                tree: snapshot.tree,
                paths: snapshot.paths,
              }
            : null,
      };
    }
    updateJob(id, "sent", { code: code ? JSON.stringify(code) : null });
    wanted();
    const { have } = await call.json<{ have: string[] }>(
      "POST",
      `/${id}/prepare`,
      body
    );
    wanted();
    if (top && refs.length > 0) {
      bundle = await packBundle(top, refs, have, bundlePath(id));
      if (bundle) {
        const size = (await fsp.stat(bundle)).size;
        const sent = await call.raw(
          "PUT",
          `/${id}/bundle`,
          fs.createReadStream(bundle),
          size
        );
        if (sent.status !== 200) {
          throw new Error(`${machine.name} didn't take the code`);
        }
      }
    }
    wanted();
    await call.json("POST", `/${id}/start`, {});
    wanted();
    updateJob(id, "sent", { step: `Setting up on ${machine.name}` }, [
      "sending",
    ]);
  } catch (error) {
    failed(id, error);
    // What it may have made there so far
    await call.raw("DELETE", `/${id}`).catch(() => {});
  } finally {
    await fsp.rm(bundlePath(id), { force: true }).catch(() => {});
    if (top) await dropRefs(top, id);
  }
}

const bundlePath = (id: string) =>
  path.join(os.tmpdir(), `agentos-${id}.bundle`);

/** The refs a job's code was packed from, out of the chat's repository */
async function dropRefs(top: string, id: string): Promise<void> {
  for (const ref of [`${refsOf(id)}/head`, `${refsOf(id)}/snap`]) {
    await git(["update-ref", "-d", ref], { cwd: top }).catch(() => {});
  }
}

/**
 * A job this server was sending when it stopped (a restart): what the send
 * left in the chat's repository and in the temp folder goes. follow() then
 * learns from the machine whether it ever got the job
 */
async function tidyInterrupted(): Promise<void> {
  for (const row of jobsIn("sent", ["sending"])) {
    await fsp.rm(bundlePath(row.id), { force: true }).catch(() => {});
    const session = row.origin_session ? getSession(row.origin_session) : null;
    const cwd = session ? sessionCwd(session) : null;
    if (!cwd || !fs.existsSync(cwd)) continue;
    const top = await toplevel(cwd).catch(() => null);
    if (top) await dropRefs(top, row.id);
  }
}

/** Starts the next waiting job on every machine that is free */
export async function pump(): Promise<void> {
  if (isMachineMode() || !machinesOn()) return;
  const busy = new Set(
    jobsIn("sent", ["sending", "running", "waiting"]).map((r) => r.machine_id)
  );
  for (const row of jobsIn("sent", ["queued"])) {
    if (busy.has(row.machine_id)) continue;
    const machine = machineById(row.machine_id);
    if (!machine || machine.status !== "approved") {
      failed(row.id, new Error(JOB_REFUSALS.no_machine));
      continue;
    }
    // Off for now: it keeps its place and goes when the machine is back,
    // for a day
    if (!online(machine)) {
      if (Date.now() - row.created_at > QUEUE_WAIT_MS) {
        failed(
          row.id,
          new Error(`${machine.name} stayed off for a day. Nothing was sent.`)
        );
        continue;
      }
      updateJob(row.id, "sent", {
        step: `${machine.name} is off; it goes when the machine is back`,
      });
      continue;
    }
    busy.add(row.machine_id);
    const s = state();
    s.sending.add(row.id);
    void send(row).finally(() => s.sending.delete(row.id));
  }
}

async function fetchPatch(call: Call, id: string): Promise<void> {
  const answer = await call.raw(
    "GET",
    `/${id}/patch`,
    undefined,
    undefined,
    PATCH_MAX + 1024
  );
  if (
    answer.status !== 200 ||
    answer.body.length === 0 ||
    answer.body.length > PATCH_MAX
  ) {
    return;
  }
  await fsp.mkdir(path.dirname(patchFile(id)), { recursive: true });
  await fsp.writeFile(patchFile(id), answer.body, { mode: 0o600 });
}

/** Asks each machine how its jobs are doing */
async function follow(): Promise<void> {
  const s = state();
  for (const row of jobsIn("sent", ["sending", "running", "waiting"])) {
    if (s.sending.has(row.id)) continue;
    const machine = machineById(row.machine_id);
    if (!machine || machine.status !== "approved") {
      failed(row.id, new Error("Its machine is no longer linked."));
      continue;
    }
    if (!online(machine)) {
      updateJob(row.id, "sent", {
        step: `${machine.name} can't be reached; waiting for it`,
      });
      continue;
    }
    const call = caller(machine.id);
    try {
      const report = cleanReport(await call.json("GET", `/${row.id}`));
      // "queued" is this server's own word: a machine never says it
      if (!report || report.state === "queued") continue;
      if (report.state === "done") {
        if (report.patch) await fetchPatch(call, row.id).catch(() => {});
        updateJob(
          row.id,
          "sent",
          {
            state: "done",
            step: null,
            question: null,
            job_session: report.jobSession,
            result: report.result,
            changed: report.changed ? JSON.stringify(report.changed) : null,
            // This server's clock, as started_at is
            ended_at: Date.now(),
          },
          ["sending", "running", "waiting"]
        );
      } else if (report.state === "failed" || report.state === "stopped") {
        updateJob(
          row.id,
          "sent",
          {
            state: report.state,
            step: null,
            question: null,
            job_session: report.jobSession,
            error: report.error,
            ended_at: Date.now(),
          },
          ["sending", "running", "waiting"]
        );
      } else {
        updateJob(
          row.id,
          "sent",
          {
            state: report.state,
            step: report.state === "sending" ? report.step : null,
            question: report.question,
            job_session: report.jobSession,
            // From when it began to run, not from when its code set off
            ...(row.state === "sending" && report.state !== "sending"
              ? { started_at: Date.now() }
              : {}),
          },
          ["sending", "running", "waiting"]
        );
      }
    } catch (error) {
      // The machine doesn't know it: this server restarted mid-copy
      if ((error as { status?: number }).status === 404) {
        failed(
          row.id,
          new Error(
            `${machine.name} never got this job (AgentOS restarted while its code was being copied). Run it again.`
          )
        );
      }
    }
  }
  // A stop the machine hasn't heard yet (it was off)
  for (const row of jobsIn("sent", ["stopped"])) {
    // One still being sent takes itself back when its send notices
    if (row.remove_at !== 1 || s.sending.has(row.id)) continue;
    const machine = machineById(row.machine_id);
    if (!machine || !online(machine)) continue;
    const told = await caller(machine.id)
      .raw("DELETE", `/${row.id}`)
      .catch(() => null);
    if (told && (told.status === 200 || told.status === 404)) {
      updateJob(row.id, "sent", { remove_at: null });
    }
  }
}

async function tick(): Promise<void> {
  const s = state();
  if (s.working) return;
  s.working = true;
  try {
    await follow();
    await pump();
  } catch (error) {
    console.error("[jobs] tick:", error);
  } finally {
    s.working = false;
  }
}

/** The hub's ticker: follows running jobs and starts waiting ones */
export function startJobs(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  void tidyInterrupted().catch((error) =>
    console.error("[jobs] tidying:", error)
  );
  setInterval(() => {
    if (!machinesOn()) return;
    // Nothing to do most of the time: one cheap query
    if (
      jobsIn("sent", ["queued", "sending", "running", "waiting", "stopped"])
        .length === 0
    ) {
      return;
    }
    void tick();
  }, 4000).unref();
  setInterval(
    () => {
      const before = Date.now() - ROW_KEEP_MS;
      // Every row that goes takes its patch with it
      const old = getDb()
        .prepare(
          `SELECT id FROM machine_jobs
           WHERE role = 'sent' AND ended_at IS NOT NULL AND ended_at < ?`
        )
        .all(before) as { id: string }[];
      for (const { id } of old) {
        if (JOB_ID.test(id)) fs.rm(patchFile(id), { force: true }, () => {});
      }
      getDb()
        .prepare(
          `DELETE FROM machine_jobs
           WHERE role = 'sent' AND ended_at IS NOT NULL AND ended_at < ?`
        )
        .run(before);
    },
    6 * 60 * 60 * 1000
  ).unref();
}

/** Stops a job; `bySession` limits it to that chat's own jobs */
export async function stopJob(
  id: string,
  bySession?: string | null
): Promise<Job | null> {
  const row = JOB_ID.test(id) ? jobRow(id, "sent") : null;
  if (!row) return null;
  if (bySession !== undefined && row.origin_session !== bySession) {
    throw new JobRefused("That job belongs to another chat.", 403);
  }
  if (isOver(row.state)) return toJob(row);
  const wasQueued = row.state === "queued";
  updateJob(id, "sent", {
    state: "stopped",
    step: null,
    question: null,
    ended_at: Date.now(),
    // 1: its machine still has to be told (follow)
    remove_at: wasQueued ? null : 1,
  });
  // One still being sent is taken back by its send (send's own check); the
  // machine may not have it yet, so its "not here" would say nothing
  if (!wasQueued && !state().sending.has(id)) {
    const machine = machineById(row.machine_id);
    if (machine && online(machine)) {
      const told = await caller(machine.id)
        .raw("DELETE", `/${id}`)
        .catch(() => null);
      if (told && (told.status === 200 || told.status === 404)) {
        updateJob(id, "sent", { remove_at: null });
      }
    }
  }
  void pump();
  return jobView(id);
}

/** Resolves when the job is over or needs the user, or after `ms` */
export async function waitForJob(id: string, ms: number): Promise<Job | null> {
  const until = Date.now() + Math.min(Math.max(ms, 0), 30 * 60 * 1000);
  for (;;) {
    const job = jobView(id);
    if (!job || isOver(job.state) || job.state === "waiting") return job;
    if (Date.now() >= until) return job;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** The space jobs take on a machine, as it reports it */
export async function machineSpace(
  machineId: string
): Promise<JobSpace | null> {
  const machine = machineById(machineId);
  if (!machine || machine.status !== "approved" || !online(machine))
    return null;
  if (!machineCaps(machine).includes(CAP_JOBS)) return null;
  return cleanSpace(
    await caller(machine.id)
      .json("GET", "/space")
      .catch(() => null)
  );
}

/** Clears kept build output on a machine: one project's, or all (null) */
export async function clearMachineCache(
  machineId: string,
  name: string | null
): Promise<boolean> {
  const machine = machineById(machineId);
  if (!machine || machine.status !== "approved" || !online(machine))
    return false;
  const answer = await caller(machine.id)
    .raw("DELETE", `/space${name ? `?cache=${encodeURIComponent(name)}` : ""}`)
    .catch(() => null);
  return answer?.status === 200;
}
