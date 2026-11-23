/**
 * The side that runs a job. Everything a job makes on this machine is in
 * one folder, <repositories folder>/.jobs:
 *
 *   .jobs/work/<project>-<id>/   the job's own working folder (a git
 *                                worktree, or a plain folder without code);
 *                                removed after the job
 *   .jobs/cache/<project>/       build output kept between jobs
 *   .jobs/repos/<project>.git    the code of a project this machine has no
 *                                checkout of
 *   .jobs/incoming/              a bundle on its way in
 *
 * A project this machine already has a checkout of is not copied again:
 * the job's folder is a worktree of that checkout, which is otherwise left
 * alone. Asked for by the hub only (app/api/link/inbox/job/*). Server only.
 */

import { execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import { readScreenPrompt } from "../agent-origin";
import { folderBytes, freeBytes } from "../backup/store";
import { getDb, queries, type Project, type Session } from "../db";
import { slugify } from "../git";
import { hubAgents } from "../link/machine";
import { tildePath } from "../repos-dir";
import { isRunning, tmuxNameOf } from "../session-launch";
import { findCheckout, reposBase, trustScreen } from "../session-move";
import { sessionReplyContext } from "../session-reply-context";
import { parseStartedBy } from "../session-started-by";
import { settleSession } from "../settle";
import { git } from "../turns-git";
import {
  materialise,
  verifyMaterialised,
  type MoveSnapshot,
} from "../worktree-move-git";
import {
  deleteJobsBefore,
  insertJob,
  jobRow,
  jobsIn,
  parseJson,
  updateJob,
  type JobRow,
} from "./store";
import {
  CACHE_IDLE_MS,
  CACHE_MAX_BYTES,
  JOB_ID,
  KEEP_DONE_MS,
  KEEP_FAILED_MS,
  PATCH_MAX,
  RESULT_MAX,
  TASK_MAX,
  TITLE_MAX,
  isActive,
  isOver,
  jobPrompt,
  type JobChanged,
  type JobReport,
  type JobSpace,
} from "./types";

const execFileAsync = promisify(execFile);

export const JOBS_FOLDER = ".jobs";
const MARKER = ".agentos";
const LONG_MS = 180_000;
const SHA = /^[0-9a-f]{40,64}$/;
const HAVE_MAX = 400;
const BUNDLE_MAX = 2 * 1024 * 1024 * 1024;
const MIN_FREE = 5 * 1024 * 1024 * 1024;
/** Jobs getting ready or running here at once, whatever the hub asks */
const ACTIVE_MAX = 4;
const ROW_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export class JobRefused extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const base = () => path.join(reposBase(), JOBS_FOLDER);
const workDir = () => path.join(base(), "work");
const cacheDir = () => path.join(base(), "cache");
const reposDir = () => path.join(base(), "repos");
const incomingDir = () => path.join(base(), "incoming");
const bundleFile = (id: string) => path.join(incomingDir(), `${id}.bundle`);
const patchFile = (id: string) => path.join(incomingDir(), `${id}.patch`);
const refsOf = (id: string) => `refs/agent-os/jobs/${id}`;

async function ensureBase(): Promise<void> {
  for (const dir of [workDir(), cacheDir(), reposDir(), incomingDir()]) {
    await fsp.mkdir(dir, { recursive: true });
  }
  await fsp
    .writeFile(
      path.join(base(), MARKER),
      "AgentOS keeps everything its jobs make on this machine in this folder: working folders (work), build output kept between jobs (cache) and the code of projects not otherwise here (repos). It is safe to delete while no job is running.\n",
      { flag: "wx" }
    )
    .catch(() => {});
}

/** Inside one of this folder's own folders, and not the folder itself */
function inside(parent: string, dir: string): boolean {
  const p = path.resolve(parent) + path.sep;
  return path.resolve(dir).startsWith(p) && path.resolve(dir) !== p;
}

const has = (repo: string, rev: string) =>
  git(["rev-parse", "--verify", "--quiet", rev], { cwd: repo }).then(
    () => true,
    () => false
  );

/** The main folder of the repository `top` belongs to (a worktree names its own) */
async function mainOf(top: string): Promise<string> {
  try {
    const common = (
      await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd: top,
      })
    ).trim();
    if (!common) return top;
    return path.basename(common) === ".git" ? path.dirname(common) : common;
  } catch {
    return top;
  }
}

interface RepoIn {
  name: string;
  remote: string | null;
  subdir: string;
}

export interface PrepareBody {
  title: string;
  task: string;
  origin: { session: string | null; name: string | null; from: string };
  repo: RepoIn | null;
  head: string | null;
  snapshot: MoveSnapshot | null;
}

interface Kept {
  subdir: string;
  head: string | null;
  snapshot: MoveSnapshot | null;
  from: string;
  slug: string;
}

function snapshotOf(value: unknown, head: string): MoveSnapshot | null {
  const v = value as Partial<MoveSnapshot> | null;
  if (!v || !SHA.test(String(v.commit)) || !SHA.test(String(v.tree))) {
    return null;
  }
  const paths = (Array.isArray(v.paths) ? v.paths : [])
    .filter(
      (p) =>
        p &&
        typeof p.path === "string" &&
        p.path.length > 0 &&
        p.path.length < 4096 &&
        !path.isAbsolute(p.path) &&
        !p.path.split("/").includes("..") &&
        (p.change === "added" ||
          p.change === "modified" ||
          p.change === "deleted")
    )
    .slice(0, 20000)
    .map((p) => ({
      path: p.path,
      change: p.change,
      mode:
        typeof p.mode === "string" && /^[0-7]{6}$/.test(p.mode) ? p.mode : null,
    }));
  return {
    ref: "",
    commit: String(v.commit),
    tree: String(v.tree),
    head,
    paths: paths as MoveSnapshot["paths"],
    skipped: [],
  };
}

export function cleanPrepare(value: unknown): PrepareBody | null {
  const v = value as Partial<PrepareBody> | null;
  const str = (x: unknown, max: number) =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;
  const title = str(v?.title, TITLE_MAX);
  const task = str(v?.task, TASK_MAX);
  if (!v || !title || !task) return null;
  let repo: RepoIn | null = null;
  let head: string | null = null;
  if (v.repo) {
    const name = str(v.repo.name, 120);
    head = typeof v.head === "string" && SHA.test(v.head) ? v.head : null;
    const subdir = typeof v.repo.subdir === "string" ? v.repo.subdir : "";
    if (
      !name ||
      !head ||
      path.isAbsolute(subdir) ||
      subdir.split(/[\\/]/).includes("..")
    ) {
      return null;
    }
    repo = {
      name,
      remote: str(v.repo.remote, 600),
      subdir: subdir.slice(0, 600),
    };
  }
  return {
    title,
    task,
    origin: {
      session: str(v.origin?.session, 100),
      name: str(v.origin?.name, 120),
      from: str(v.origin?.from, 80) ?? "the server",
    },
    repo,
    head,
    snapshot: repo && head ? snapshotOf(v.snapshot, head) : null,
  };
}

/**
 * Step one: where the job's code will come from here, and what this machine
 * already has of it (so only the rest is sent)
 */
export async function prepareJob(
  id: string,
  body: PrepareBody
): Promise<{ have: string[] }> {
  if (!JOB_ID.test(id)) throw new JobRefused("Not a job");
  if (hubAgents() === false) {
    throw new JobRefused(
      "This machine doesn't take work from sessions on other machines.",
      403
    );
  }
  if (jobRow(id, "run")) throw new JobRefused("This job is already here", 409);
  if (jobsIn("run", ["sending", "running", "waiting"]).length >= ACTIVE_MAX) {
    throw new JobRefused("This machine is busy with other jobs", 429);
  }
  await ensureBase();
  const free = await freeBytes().catch(() => null);
  if (free !== null && free < MIN_FREE) {
    throw new JobRefused("This machine is nearly out of disk space", 507);
  }
  const slug = slugify(body.repo?.name ?? "job") || "job";
  let repo: string | null = null;
  const have: string[] = [];
  if (body.repo && body.head) {
    const found = body.repo.remote
      ? await findCheckout(body.repo.remote)
      : null;
    if (found) {
      repo = await mainOf(found);
    } else {
      repo = path.join(reposDir(), `${slug}.git`);
      if (!fs.existsSync(repo)) {
        await fsp.mkdir(repo, { recursive: true });
        await git(["init", "--bare", "--quiet"], { cwd: repo });
      }
    }
    if (await has(repo, `${body.head}^{commit}`)) have.push(body.head);
    const refs = await git(
      [
        "for-each-ref",
        "--format=%(objectname) %(objecttype)",
        "refs/remotes",
        "refs/heads",
      ],
      { cwd: repo }
    ).catch(() => "");
    for (const line of refs.split("\n")) {
      const [sha, type] = line.split(" ");
      if (type === "commit" && !have.includes(sha) && have.length < HAVE_MAX) {
        have.push(sha);
      }
    }
  }
  const kept: Kept = {
    subdir: body.repo?.subdir ?? "",
    head: body.head,
    snapshot: body.snapshot,
    from: body.origin.from,
    slug,
  };
  insertJob({
    id,
    role: "run",
    machine_id: "hub",
    origin_session: body.origin.session,
    origin_name: body.origin.name,
    title: body.title,
    task: body.task,
    state: "sending",
    step: "Receiving the code",
    repo,
    cache: path.join(cacheDir(), slug),
    // What start needs, kept with the row so a restart in between loses nothing
    code: JSON.stringify(kept),
  });
  return { have };
}

/** Step two (only when something is missing here): the code as a git bundle */
export async function receiveJobBundle(
  id: string,
  body: ReadableStream<Uint8Array> | null
): Promise<void> {
  const row = jobRow(id, "run");
  if (!row || row.state !== "sending" || !row.repo) {
    throw new JobRefused("This job isn't waiting for its code", 409);
  }
  if (!body) throw new JobRefused("No code came");
  await ensureBase();
  const file = bundleFile(id);
  let bytes = 0;
  const source = Readable.fromWeb(body as never);
  source.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > BUNDLE_MAX)
      source.destroy(new JobRefused("Too much code", 413));
  });
  receiving.add(id);
  try {
    await pipeline(source, fs.createWriteStream(file, { mode: 0o600 }));
  } catch (error) {
    await fsp.rm(file, { force: true });
    throw error;
  } finally {
    receiving.delete(id);
  }
}

function fail(id: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "It didn't start";
  console.error("[jobs] run", id, error);
  const now = Date.now();
  updateJob(
    id,
    "run",
    {
      state: "failed",
      error: message,
      step: null,
      ended_at: now,
      remove_at: now + KEEP_FAILED_MS,
    },
    ["sending", "running", "waiting"]
  );
}

const starting = new Set<string>();
/** Jobs whose code is arriving right now */
const receiving = new Set<string>();

/** Claude's own files in a project: settings, hooks, skills, agents, MCP servers */
const AGENT_CONFIG = new Set([".claude", ".mcp.json"]);

/**
 * Takes Claude's project files out of a job's copy of the code, wherever
 * they are in it. They came from another machine and can make Claude run
 * commands without asking (hooks, permission settings, a skill's or an
 * agent's allowed tools, MCP servers), which a job may never do. What is
 * set up for Claude on this machine itself still applies. Symlinks are not
 * followed. Answers how many were removed
 */
export async function stripAgentConfig(dir: string): Promise<number> {
  let removed = 0;
  const walk = async (folder: string, depth: number): Promise<void> => {
    const entries = await fsp
      .readdir(folder, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (AGENT_CONFIG.has(entry.name)) {
        await fsp.rm(full, { recursive: true, force: true });
        removed++;
        continue;
      }
      // The worktree's own .git is a file; a nested repository's isn't code
      if (entry.name === ".git") continue;
      if (entry.isDirectory() && depth < 64) await walk(full, depth + 1);
    }
  };
  await walk(dir, 0);
  return removed;
}

/** Left out of what a job sends back: they were taken out of its copy */
const NOT_SENT_BACK = [
  ":(exclude,glob)**/.claude",
  ":(exclude,glob)**/.claude/**",
  ":(exclude,glob)**/.mcp.json",
];

/** Step three: the folder is made and the job's session started, in the background */
export function startJob(id: string): void {
  const row = jobRow(id, "run");
  if (!row || row.state !== "sending") {
    throw new JobRefused("This job can't start", 409);
  }
  if (starting.has(id)) return;
  starting.add(id);
  void setUp(row)
    .catch((error) => fail(id, error))
    .finally(async () => {
      starting.delete(id);
      // Stopped while it was being set up: what was made so far goes
      const now = jobRow(id, "run");
      if (now?.state === "stopped") await removeJobFiles(now).catch(() => {});
    });
}

/** The project here whose folder is this repository, if there is one */
function projectOf(repo: string | null): string {
  if (!repo) return "uncategorized";
  const real = (dir: string) => {
    try {
      return fs.realpathSync(dir.replace(/^~(?=$|\/)/, os.homedir()));
    } catch {
      return null;
    }
  };
  const wanted = real(repo);
  for (const p of queries.getAllProjects(getDb()).all() as Project[]) {
    if (p.is_uncategorized || !p.working_directory) continue;
    if (wanted && real(p.working_directory) === wanted) return p.id;
  }
  return "uncategorized";
}

async function localApi<T>(
  method: string,
  pathname: string,
  body?: unknown
): Promise<T> {
  const port = Number(process.env.PORT || "3011");
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-AgentOS-Origin": "agent",
      // A session another machine's session started (lib/session-started-by.ts)
      "x-agentos-chain": "0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `${res.status} on ${pathname}`);
  return data;
}

async function setUp(row: JobRow): Promise<void> {
  const id = row.id;
  const kept = parseJson<Kept>(row.code);
  if (!kept) throw new Error("The job arrived incomplete");
  await ensureBase();
  // The whole id: two jobs never share a folder
  const dir = path.join(workDir(), `${kept.slug}-${id.slice(4)}`);
  updateJob(id, "run", { step: "Setting up its folder", folder: dir });
  if (row.repo && kept.head) {
    const bundle = bundleFile(id);
    if (fs.existsSync(bundle)) {
      try {
        await git(
          [
            // Another machine's data: every object is checked
            "-c",
            "fetch.fsckObjects=true",
            "-c",
            "transfer.fsckObjects=true",
            "fetch",
            "--quiet",
            "--no-tags",
            bundle,
            `+${refsOf(id)}/*:${refsOf(id)}/*`,
          ],
          { cwd: row.repo, timeoutMs: LONG_MS }
        );
      } finally {
        await fsp.rm(bundle, { force: true });
      }
    }
    if (
      !(await has(row.repo, `${kept.head}^{commit}`)) ||
      (kept.snapshot &&
        !(await has(row.repo, `${kept.snapshot.commit}^{commit}`)))
    ) {
      throw new Error("The code didn't arrive complete");
    }
    await git(["worktree", "add", "--quiet", "--detach", dir, kept.head], {
      cwd: row.repo,
      timeoutMs: LONG_MS,
    });
    if (kept.snapshot && kept.snapshot.paths.length > 0) {
      await materialise(kept.snapshot, "", dir);
      if (!(await verifyMaterialised(kept.snapshot, dir))) {
        throw new Error("The unsaved changes didn't arrive complete");
      }
    }
  } else {
    await fsp.mkdir(dir, { recursive: true });
  }
  const cache = row.cache ?? path.join(cacheDir(), kept.slug);
  await fsp.mkdir(cache, { recursive: true });
  // When this project's kept build output was last of use
  const now = new Date();
  await fsp.utimes(cache, now, now).catch(() => {});

  const stripped = await stripAgentConfig(dir);
  const cwd = kept.subdir ? path.join(dir, kept.subdir) : dir;
  await fsp.mkdir(cwd, { recursive: true });
  // The folder the chat was in, followed through any link in the code: it
  // has to be inside the job's own folder
  const realDir = await fsp.realpath(dir);
  const realCwd = await fsp.realpath(cwd);
  if (realCwd !== realDir && !realCwd.startsWith(realDir + path.sep)) {
    throw new Error("The chat's folder leads outside its code");
  }
  updateJob(id, "run", { step: "Starting" });
  const { session } = await localApi<{ session: Session }>(
    "POST",
    "/api/sessions",
    {
      name: `Job: ${row.title}`.slice(0, 80),
      workingDirectory: cwd,
      projectId: projectOf(row.repo),
      agentType: "claude",
      // Asks before it runs or changes anything, whatever this machine's or
      // the project's default is
      autoApprove: false,
      permissionMode: "manual",
      useWorktree: false,
      initialPrompt: jobPrompt({
        title: row.title,
        task: row.task,
        from: kept.from,
        chat: row.origin_name,
        cache,
        code: !!row.repo,
        stripped: stripped > 0,
      }),
      launch: true,
    }
  );
  // Which job it is, beside who started it
  const by = parseStartedBy(session.started_by);
  getDb()
    .prepare(`UPDATE sessions SET started_by = ? WHERE id = ?`)
    .run(
      JSON.stringify({
        ...(by ?? {
          machineId: "hub",
          machine: kept.from,
          depth: 1,
          at: Date.now(),
        }),
        job: { id, title: row.title, chat: row.origin_name },
      }),
      session.id
    );
  const stillWanted = updateJob(
    id,
    "run",
    {
      state: "running",
      step: null,
      job_session: session.id,
      started_at: Date.now(),
    },
    ["sending"]
  );
  if (!stillWanted) {
    // Stopped while it was being set up: startJob clears the folder
    await localApi("DELETE", `/api/sessions/${session.id}`).catch(() => {});
    return;
  }
  // Claude's "trust this folder?" in a folder new to this machine. What that
  // question guards (the project's own settings, hooks and MCP servers) was
  // taken out above, so it is answered
  void trustScreen(session, true).catch(() => {});
}

/** The last time each job was seen finished; two looks in a row settle it */
const seenDone = new Map<string, number>();
const SETTLE_MS = 3000;
const checking = new Set<string>();

async function collect(row: JobRow, kept: Kept | null): Promise<JobChanged> {
  const none: JobChanged = { files: [], more: 0, tooBig: false };
  if (!row.repo || !row.folder || !kept?.head) return none;
  const from = kept.snapshot?.commit ?? kept.head;
  try {
    // The folder is the job's own and is removed: its index is free to use
    const top = row.folder;
    await git(["add", "-A"], { cwd: top, timeoutMs: LONG_MS });
    const stat = await git(
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        "-z",
        from,
        "--",
        ".",
        ...NOT_SENT_BACK,
      ],
      { cwd: top, timeoutMs: LONG_MS }
    );
    const files = stat
      .split("\0")
      .map((line) => line.split("\t"))
      .filter((parts) => parts.length === 3 && parts[2])
      .map(([added, removed, file]) => ({
        path: file,
        added: Number(added) || 0,
        removed: Number(removed) || 0,
      }));
    if (files.length === 0) return none;
    const { stdout } = await execFileAsync(
      "git",
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        from,
        "--",
        ".",
        ...NOT_SENT_BACK,
      ],
      {
        cwd: top,
        encoding: "buffer",
        maxBuffer: PATCH_MAX + 1024,
        timeout: LONG_MS,
      }
    ).catch(() => ({ stdout: null as Buffer | null }));
    const tooBig = !stdout || stdout.length > PATCH_MAX;
    if (!tooBig)
      await fsp.writeFile(patchFile(row.id), stdout, { mode: 0o600 });
    return {
      files: files.slice(0, 200),
      more: Math.max(0, files.length - 200),
      tooBig,
    };
  } catch (error) {
    console.error("[jobs] changes of", row.id, error);
    return none;
  }
}

async function finish(row: JobRow, result: string): Promise<void> {
  const kept = parseJson<Kept>(row.code);
  const changed = await collect(row, kept);
  const now = Date.now();
  updateJob(
    row.id,
    "run",
    {
      state: "done",
      step: null,
      question: null,
      result: result.slice(0, RESULT_MAX),
      changed: JSON.stringify(changed),
      ended_at: now,
      remove_at: now + KEEP_DONE_MS,
    },
    ["running", "waiting"]
  );
  // The job is over, so its session ends too: nothing keeps running on this
  // machine and it doesn't sit under Needs you. Its chat stays readable (and
  // can be carried on with Undo) until the folder is removed
  const session = row.job_session
    ? (queries.getSession(getDb()).get(row.job_session) as Session | undefined)
    : undefined;
  if (session) {
    await settleSession(session, { reason: "job_done", force: true }).catch(
      (error) => console.error("[jobs] ending the session of", row.id, error)
    );
  }
}

/** Looks at a running job's session and moves the job along */
async function look(row: JobRow): Promise<void> {
  if (row.state !== "running" && row.state !== "waiting") return;
  if (checking.has(row.id)) return;
  checking.add(row.id);
  try {
    const session = row.job_session
      ? (queries.getSession(getDb()).get(row.job_session) as
          | Session
          | undefined)
      : undefined;
    const ended = (error: string) => {
      const now = Date.now();
      updateJob(
        row.id,
        "run",
        {
          state: "failed",
          error,
          step: null,
          question: null,
          ended_at: now,
          remove_at: now + KEEP_FAILED_MS,
        },
        ["running", "waiting"]
      );
    };
    if (!session) return ended("Its session on this machine was removed.");
    if (!(await isRunning(session))) {
      return ended("Its session stopped before the job was finished.");
    }
    const [context, prompt] = await Promise.all([
      sessionReplyContext(session).catch(() => null),
      readScreenPrompt(tmuxNameOf(session)).catch(() => null),
    ]);
    const waits = (question: string | null) => {
      seenDone.delete(row.id);
      updateJob(
        row.id,
        "run",
        { state: "waiting", question: question?.slice(0, 600) ?? null },
        ["running", "waiting"]
      );
    };
    if (prompt && (!context || context.kind === "working")) {
      return waits(prompt.question || prompt.title || "It asks for permission");
    }
    if (!context || context.kind === "working") {
      seenDone.delete(row.id);
      updateJob(row.id, "run", { state: "running", question: null }, [
        "running",
        "waiting",
      ]);
      return;
    }
    if (context.kind === "ask" || context.kind === "permission") {
      return waits(context.question ?? context.excerpt ?? null);
    }
    // Its turn is over: once more a moment later, in case it carries on
    const first = seenDone.get(row.id);
    if (!first) {
      seenDone.set(row.id, Date.now());
      return;
    }
    if (Date.now() - first < SETTLE_MS) return;
    seenDone.delete(row.id);
    await finish(
      row,
      context.text || context.excerpt || "It finished without a message."
    );
  } finally {
    checking.delete(row.id);
  }
}

export async function jobReport(id: string): Promise<JobReport | null> {
  let row = jobRow(id, "run");
  if (!row) return null;
  await look(row).catch((error) => console.error("[jobs] look", id, error));
  row = jobRow(id, "run") ?? row;
  return {
    state: row.state,
    step: row.step,
    question: row.question,
    jobSession: row.job_session,
    result: row.result,
    changed: isOver(row.state) ? parseJson<JobChanged>(row.changed) : null,
    patch: fs.existsSync(patchFile(id)),
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/** The patch of what the job changed; null when there is none */
export function jobPatch(id: string): fs.ReadStream | null {
  if (!JOB_ID.test(id) || !jobRow(id, "run")) return null;
  const file = patchFile(id);
  return fs.existsSync(file) ? fs.createReadStream(file) : null;
}

async function removeJobFiles(row: JobRow) {
  const session = row.job_session;
  if (session) {
    await localApi("DELETE", `/api/sessions/${session}`).catch(() => {});
  }
  const dir = row.folder;
  if (dir && inside(workDir(), dir)) {
    if (row.repo) {
      await git(["worktree", "remove", "--force", dir], {
        cwd: row.repo,
        timeoutMs: LONG_MS,
      }).catch(() => {});
    }
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (row.repo && fs.existsSync(row.repo)) {
    // Never in the user's own checkout: prune also forgets worktrees of
    // theirs whose folder is away just now (an unmounted drive)
    if (inside(reposDir(), row.repo)) {
      await git(["worktree", "prune"], { cwd: row.repo }).catch(() => {});
    }
    const refs = await git(
      ["for-each-ref", "--format=%(refname)", refsOf(row.id)],
      { cwd: row.repo }
    ).catch(() => "");
    for (const ref of refs.split("\n").filter(Boolean)) {
      await git(["update-ref", "-d", ref], { cwd: row.repo }).catch(() => {});
    }
  }
  await fsp.rm(bundleFile(row.id), { force: true }).catch(() => {});
  await fsp.rm(patchFile(row.id), { force: true }).catch(() => {});
  updateJob(row.id, "run", {
    folder: null,
    job_session: null,
    remove_at: null,
  });
}

/** The user (or the chat that sent it) stopped it: its session and folder go */
export async function stopJob(id: string): Promise<boolean> {
  const row = jobRow(id, "run");
  if (!row) return false;
  if (!isOver(row.state)) {
    const now = Date.now();
    updateJob(id, "run", {
      state: "stopped",
      step: null,
      question: null,
      ended_at: now,
    });
  }
  // One being set up clears itself when its session is there (setUp)
  if (!starting.has(id)) await removeJobFiles(jobRow(id, "run") ?? row);
  return true;
}

async function cacheList(): Promise<
  { name: string; dir: string; bytes: number; usedAt: number }[]
> {
  const names = await fsp.readdir(cacheDir()).catch(() => [] as string[]);
  const out = [];
  for (const name of names) {
    const dir = path.join(cacheDir(), name);
    const stat = await fsp.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    out.push({
      name,
      dir,
      bytes: await folderBytes(dir).catch(() => 0),
      usedAt: stat.mtimeMs,
    });
  }
  return out;
}

/** Whether a job that is still going uses this project's kept build output */
const cacheInUse = (dir: string) =>
  jobsIn("run", ["sending", "running", "waiting"]).some(
    (row) => row.cache && path.resolve(row.cache) === path.resolve(dir)
  );

let lastCacheSweep = 0;

/** Often: jobs followed to their end, folders of ended jobs, stale build output */
export async function sweepJobs(now = Date.now()): Promise<void> {
  for (const row of jobsIn("run", ["running", "waiting"])) {
    await look(row).catch((error) =>
      console.error("[jobs] look", row.id, error)
    );
  }
  // Its code never arrived (the hub went away mid-way)
  for (const row of jobsIn("run", ["sending"])) {
    if (
      now - row.created_at > 30 * 60 * 1000 &&
      !starting.has(row.id) &&
      !receiving.has(row.id)
    ) {
      fail(row.id, new Error("Its code never arrived."));
    }
  }
  for (const row of jobsIn("run", ["done", "failed", "stopped"])) {
    // Nothing of it is left here (a failed one may still have its code)
    if (!row.folder && !row.job_session && row.remove_at === null) continue;
    if (row.remove_at === null || row.remove_at <= now) {
      await removeJobFiles(row).catch((error) =>
        console.error("[jobs] clearing", row.id, error)
      );
    }
  }
  // Measuring kept build output walks many files: every half hour
  if (now - lastCacheSweep < 30 * 60 * 1000) return;
  lastCacheSweep = now;
  deleteJobsBefore("run", now - ROW_KEEP_MS);
  if (!fs.existsSync(cacheDir())) return;
  const caches = (await cacheList()).sort((a, b) => a.usedAt - b.usedAt);
  let total = caches.reduce((sum, c) => sum + c.bytes, 0);
  for (const cache of caches) {
    const idle = now - cache.usedAt > CACHE_IDLE_MS;
    if (!idle && total <= CACHE_MAX_BYTES) continue;
    if (cacheInUse(cache.dir)) continue;
    await fsp.rm(cache.dir, { recursive: true, force: true }).catch(() => {});
    total -= cache.bytes;
  }
}

export async function jobSpace(): Promise<JobSpace> {
  const exists = fs.existsSync(base());
  return {
    folder: tildePath(base(), os.homedir()),
    work: exists ? await folderBytes(workDir()).catch(() => 0) : 0,
    repos: exists ? await folderBytes(reposDir()).catch(() => 0) : 0,
    caches: exists
      ? (await cacheList()).map(({ name, bytes, usedAt }) => ({
          name,
          bytes,
          usedAt,
        }))
      : [],
    free: await freeBytes().catch(() => null),
  };
}

/** Clears one project's kept build output, or all of it; false while a job uses it */
export async function clearCache(name: string | null): Promise<boolean> {
  if (name !== null && !/^[\w.-]+$/.test(name)) return false;
  const targets = (await cacheList()).filter(
    (c) => name === null || c.name === name
  );
  let cleared = true;
  for (const cache of targets) {
    if (!inside(cacheDir(), cache.dir) || cacheInUse(cache.dir)) {
      cleared = false;
      continue;
    }
    await fsp.rm(cache.dir, { recursive: true, force: true });
  }
  return cleared;
}

/** Jobs that run here now, for this machine's own page */
export const runningHere = () =>
  jobsIn("run", ["sending", "running", "waiting"]).filter((row) =>
    isActive(row.state)
  );
