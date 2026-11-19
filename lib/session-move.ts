/**
 * The two ends of "Continue on another machine" (lib/session-move-types.ts).
 * Server only. The hub (lib/link/move.ts) calls them over each machine's
 * API and pipes the two files between them.
 *
 * Leaving (beginMoveOut): the session settles (its tmux ends, so Claude's
 * transcript is complete), its uncommitted work becomes a hidden commit
 * (lib/worktree-move-git.ts snapshotForMove) and a ref pins HEAD. The code
 * travels as a git bundle of what the other machine lacks, the conversation
 * as a tar of <sid>.jsonl and <sid>/. finishMoveOut marks the row moved;
 * abortMoveOut starts it again here.
 *
 * Arriving (prepareMoveIn, importMove): finds the repository (the folder a
 * returning session left, a checkout of the same origin, else a clone under
 * ~/AgentOS), fetches the bundle, puts the branch and the uncommitted work
 * in a folder, copies the conversation under that folder's Claude project
 * and resumes it. Nothing here touches another session's checkout: an
 * existing repository gets a new worktree.
 */

import { execFile, spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import zlib from "zlib";
import { claudeDir, projectDirFor } from "./claude-transcript";
import { getDb, queries, type Project, type Session } from "./db";
import { flagOnFor } from "./flags";
import { slugify } from "./git";
import { isPaused } from "./handoff-types";
import { queueStore } from "./queue/store";
import { launchSession, tmuxNameOf } from "./session-launch";
import {
  MOVE_ID,
  MOVE_OUT_ERRORS,
  arrivalMode,
  arrivalRow,
  arrivedNoticeText,
  parseMovedTo,
  safeBranch,
  safeRepoPath,
  sameRemote,
  type MoveInCancel,
  type MoveInResult,
  type MoveInState,
  type MoveManifest,
  type MoveOutRefusal,
  type MovedFrom,
  type MovedTo,
} from "./session-move-types";
import { SettleRefused, settleSession, unsettleSession } from "./settle";
import { UNSETTLED_REASON, isSettled } from "./settle-types";
import { expandHome, locateTranscript, sessionCwd } from "./transcript-locate";
import { GitError, git } from "./turns-git";
import {
  cleanSource,
  dropSnapshot,
  materialise,
  readWorkingTree,
  snapshotForMove,
  verifyMaterialised,
  type MoveSnapshot,
} from "./worktree-move-git";
import { TRUST_SCREEN, folderTrusted } from "./worktree-move";
import { getWorktreesDir } from "./worktrees";

const execFileAsync = promisify(execFile);

const LONG_MS = 15 * 60_000;
const SHA = /^[0-9a-f]{40}$/;
const CLAUDE_SID = /^[0-9a-f-]{36}$/;
/** The most either file may be: a tampered or runaway sender can't fill the disk */
const BUNDLE_MAX = 8 * 1024 ** 3;
const TRANSCRIPT_MAX = 2 * 1024 ** 3;
const UNPACKED_MAX = 8 * 1024 ** 3;
const SESSION_ID = /^[\w-]+$/;
/** How many of its commits a machine names, so the bundle leaves them out */
const HAVE_MAX = 400;

export class MoveRefused extends Error {
  constructor(
    readonly reason: MoveOutRefusal,
    readonly status = 409
  ) {
    super(MOVE_OUT_ERRORS[reason]);
  }
}

interface Leaving {
  sessionId: string;
  top: string;
  wasSettled: boolean;
  head: string;
  branch: string | null;
  headRef: string;
  snapshot: MoveSnapshot | null;
  transcript: string;
  sid: string;
  temp: string[];
}

interface Arriving {
  manifest: MoveManifest;
  from: { machine: string; name: string };
  self: { machine: string; name: string };
  dir: string;
  state: MoveInState;
  repo?: string;
  mode?: "return" | "existing" | "cloned" | "empty";
  /** The hub called it off while it was being put in place */
  cancelled?: boolean;
  /** What placing it created here, undone when it fails */
  made?: { worktree: string; branch: string | null };
}

// Route handlers may load this module more than once: one set of moves
const shared = globalThis as typeof globalThis & {
  __agentosMovesOut?: Map<string, Leaving>;
  __agentosMovesIn?: Map<string, Arriving>;
};
const leaving = (shared.__agentosMovesOut ??= new Map());
const arriving = (shared.__agentosMovesIn ??= new Map());

const getSession = (id: string) =>
  (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function has(top: string, object: string): Promise<boolean> {
  try {
    await git(["cat-file", "-e", object], { cwd: top });
    return true;
  } catch {
    return false;
  }
}

async function originOf(top: string): Promise<string | null> {
  try {
    return (
      (await git(["remote", "get-url", "origin"], { cwd: top })).trim() || null
    );
  } catch {
    return null;
  }
}

async function topOf(dir: string): Promise<string | null> {
  try {
    return (
      (await git(["rev-parse", "--show-toplevel"], { cwd: dir })).trim() || null
    );
  } catch {
    return null;
  }
}

// --- Leaving ---

/**
 * Settles the session and packs what the other machine needs. Throws
 * MoveRefused; on any other failure the session is started again
 */
export async function beginMoveOut(session: Session): Promise<MoveManifest> {
  if ((session.agent_type || "claude") !== "claude") {
    throw new MoveRefused("not_claude");
  }
  if (isPaused(session)) throw new MoveRefused("paused");
  // The copy left behind: the live one is on the machine it went to
  if (parseMovedTo(session.moved_to)) throw new MoveRefused("moved");
  if (isLeaving(session.id)) throw new MoveRefused("busy");
  if (!SESSION_ID.test(session.id)) throw new MoveRefused("no_conversation");
  const cwd = sessionCwd(session);
  const before = await readWorkingTree(cwd);
  if (!before) throw new MoveRefused("not_git");
  if (!before.head) throw new MoveRefused("no_commits");

  const wasSettled = isSettled(session);
  if (!wasSettled) {
    try {
      await settleSession(session, { reason: "moved" });
    } catch (error) {
      if (error instanceof SettleRefused) throw new MoveRefused("busy");
      throw error;
    }
  }
  const moveId = randomBytes(8).toString("hex");
  const headRef = `refs/agent-os/${session.id}/out-${moveId}`;
  let snapshot: MoveSnapshot | null = null;
  try {
    const fresh = getSession(session.id)!;
    const located = await locateTranscript(fresh);
    const sid = fresh.claude_session_id;
    if (
      !sid ||
      !CLAUDE_SID.test(sid) ||
      !located?.file ||
      !fs.existsSync(located.file)
    ) {
      throw new MoveRefused("no_conversation");
    }
    const state = (await readWorkingTree(cwd))!;
    if (state.uncommitted.length > 0) {
      snapshot = await snapshotForMove(cwd, session.id);
    }
    const head = snapshot?.head ?? state.head;
    await git(["update-ref", headRef, head], { cwd: state.toplevel });
    leaving.set(moveId, {
      sessionId: session.id,
      top: state.toplevel,
      wasSettled,
      head,
      branch: state.branch,
      headRef,
      snapshot,
      transcript: located.file,
      sid,
      temp: [],
    });
    return {
      v: 1,
      moveId,
      sessionId: session.id,
      name: fresh.name,
      claudeSessionId: sid,
      model: fresh.model,
      modelPinned: !!fresh.model_pinned,
      effort: fresh.effort,
      permissionMode: fresh.permission_mode,
      autoApprove: !!fresh.auto_approve,
      subagentModel: fresh.subagent_model,
      subagentOwnFirst: !!fresh.subagent_own_first,
      systemPrompt: fresh.system_prompt,
      sourceTrusted: await folderTrusted(cwd).catch(() => false),
      repo: {
        name: path.basename(state.toplevel),
        remote: await originOf(state.toplevel),
        head,
        branch: state.branch,
        subdir: path.relative(
          fs.realpathSync(state.toplevel),
          fs.realpathSync(cwd)
        ),
      },
      snapshot,
    };
  } catch (error) {
    await git(["update-ref", "-d", headRef], { cwd }).catch(() => {});
    if (snapshot) await dropSnapshot(cwd, snapshot).catch(() => {});
    if (!wasSettled) {
      await unsettleSession(getSession(session.id)!).catch((e) =>
        console.error("[session-move] starting it again:", e)
      );
    }
    throw error;
  }
}

/** A move of this session is under way from this machine */
export function isLeaving(sessionId: string): boolean {
  for (const out of leaving.values()) {
    if (out.sessionId === sessionId) return true;
  }
  return false;
}

function leavingOf(sessionId: string, moveId: string): Leaving {
  const out = MOVE_ID.test(moveId) ? leaving.get(moveId) : undefined;
  if (!out || out.sessionId !== sessionId) throw new Error("No such move");
  return out;
}

/** The conversation: <sid>.jsonl and its <sid>/ folder, as a tar.gz stream */
export function transcriptOut(sessionId: string, moveId: string): Readable {
  const out = leavingOf(sessionId, moveId);
  const dir = path.dirname(out.transcript);
  const names = [`${out.sid}.jsonl`];
  if (fs.existsSync(path.join(dir, out.sid))) names.push(out.sid);
  const child = spawn("tar", ["-czf", "-", "-C", dir, ...names], {
    // No ._ resource-fork entries from macOS
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  child.on("close", (code) => {
    if (code !== 0)
      child.stdout.destroy(new Error("Packing the conversation failed"));
  });
  return child.stdout;
}

/**
 * A git bundle of HEAD and the snapshot, without what the other machine
 * says it has. Null when it already has everything
 */
export async function bundleOut(
  sessionId: string,
  moveId: string,
  have: unknown
): Promise<string | null> {
  const out = leavingOf(sessionId, moveId);
  const named = (Array.isArray(have) ? have : [])
    .filter((sha): sha is string => typeof sha === "string" && SHA.test(sha))
    .slice(0, HAVE_MAX);
  const known: string[] = [];
  if (named.length > 0) {
    const checked = await git(["cat-file", "--batch-check"], {
      cwd: out.top,
      input: named.join("\n") + "\n",
    });
    for (const line of checked.split("\n")) {
      const [sha, type] = line.split(" ");
      if (type === "commit") known.push(sha);
    }
  }
  const refs = [out.headRef, ...(out.snapshot ? [out.snapshot.ref] : [])];
  const not = known.map((sha) => `^${sha}`);
  const count = (
    await git(["rev-list", "--count", ...refs, ...not], {
      cwd: out.top,
      timeoutMs: LONG_MS,
    })
  ).trim();
  if (count === "0") return null;
  const file = path.join(os.tmpdir(), `agentos-move-${moveId}.bundle`);
  out.temp.push(file);
  await git(["bundle", "create", file, ...refs, ...not], {
    cwd: out.top,
    timeoutMs: LONG_MS,
  });
  return file;
}

async function forget(out: Leaving, moveId: string): Promise<void> {
  leaving.delete(moveId);
  await git(["update-ref", "-d", out.headRef], { cwd: out.top }).catch(
    () => {}
  );
  for (const file of out.temp) await fsp.rm(file, { force: true });
}

/** It runs on the other machine now: the row says where it went */
export async function finishMoveOut(
  sessionId: string,
  moveId: string,
  to: { machine: string; name: string }
): Promise<void> {
  const out = leavingOf(sessionId, moveId);
  const moved: MovedTo = {
    machine: to.machine,
    name: to.name,
    at: Date.now(),
    head: out.head,
    branch: out.branch,
    snapshot: out.snapshot,
  };
  const { changes } = getDb()
    .prepare(
      `UPDATE sessions SET moved_to = ?, settled_reason = 'moved',
         updated_at = datetime('now')
       WHERE id = ? AND settled_at IS NOT NULL`
    )
    .run(JSON.stringify(moved), sessionId);
  if (changes !== 1) {
    await forget(out, moveId);
    throw new Error("It was resumed here while it moved");
  }
  // The snapshot ref stays: it is how a return tells the folder is untouched
  await forget(out, moveId);
}

/** It didn't move: started again here, as it was */
export async function abortMoveOut(
  sessionId: string,
  moveId: string
): Promise<void> {
  const out = leavingOf(sessionId, moveId);
  await forget(out, moveId);
  if (out.snapshot) await dropSnapshot(out.top, out.snapshot).catch(() => {});
  const session = getSession(sessionId);
  if (session && !out.wasSettled && isSettled(session)) {
    await unsettleSession(session);
  }
}

/**
 * Calls off whatever move this session has pending here (the hub lost the
 * answer to its first call, so it has no move id). Starts it again
 */
export async function abortPendingMoveOut(sessionId: string): Promise<void> {
  for (const [moveId, out] of [...leaving]) {
    if (out.sessionId === sessionId) await abortMoveOut(sessionId, moveId);
  }
}

/**
 * Lets go of a move nobody could confirm either way: the session stays
 * paused here (the other machine may be running it) and the user decides
 */
export async function releaseMoveOut(
  sessionId: string,
  moveId: string
): Promise<void> {
  await forget(leavingOf(sessionId, moveId), moveId);
}

// --- Arriving ---

const platformName = () =>
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "linux"
      ? "Linux"
      : process.platform;

function validManifest(value: unknown): value is MoveManifest {
  const m = value as MoveManifest;
  return (
    !!m &&
    m.v === 1 &&
    MOVE_ID.test(m.moveId) &&
    SESSION_ID.test(m.sessionId) &&
    CLAUDE_SID.test(m.claudeSessionId) &&
    typeof m.name === "string" &&
    !!m.repo &&
    SHA.test(m.repo.head) &&
    typeof m.repo.name === "string" &&
    typeof m.repo.subdir === "string" &&
    (m.repo.subdir === "" || safeRepoPath(m.repo.subdir)) &&
    (m.repo.branch === null || typeof m.repo.branch === "string") &&
    (m.repo.remote === null || typeof m.repo.remote === "string") &&
    (m.snapshot === null ||
      (SHA.test(m.snapshot.commit) &&
        SHA.test(m.snapshot.tree) &&
        m.snapshot.head === m.repo.head &&
        Array.isArray(m.snapshot.paths) &&
        m.snapshot.paths.every(
          (p) =>
            !!p &&
            safeRepoPath(p.path) &&
            ["added", "modified", "deleted"].includes(p.change)
        ) &&
        Array.isArray(m.snapshot.skipped) &&
        m.snapshot.skipped.every((file) => typeof file === "string")))
  );
}

/** Folders this machine's projects and sessions work in */
function knownFolders(): string[] {
  const db = getDb();
  const dirs = new Set<string>();
  for (const p of queries.getAllProjects(db).all() as Project[]) {
    if (p.working_directory) dirs.add(expandHome(p.working_directory));
  }
  for (const s of queries.getAllSessions(db).all() as Session[]) {
    dirs.add(sessionCwd(s));
  }
  return [...dirs].filter((d) => path.isAbsolute(d) && fs.existsSync(d));
}

async function findCheckout(remote: string): Promise<string | null> {
  const folders = knownFolders().slice(0, 80);
  const tops = await Promise.all(
    folders.map(async (dir) => {
      const top = await topOf(dir);
      return top && sameRemote(await originOf(top), remote) ? top : null;
    })
  );
  return tops.find((top) => top !== null) ?? null;
}

/**
 * https, ssh, scp-style and plain absolute-path remotes only: never a
 * transport that runs a command (ext::) or something read as an option
 */
const cloneable = (remote: string) =>
  /^(https:\/\/|ssh:\/\/|[\w.-]+@[\w.-]+:|\/)[\w./~:@%+-]+$/.test(remote);

async function cloneOrInit(
  m: MoveManifest
): Promise<{ repo: string; mode: "existing" | "cloned" | "empty" }> {
  const base = path.join(os.homedir(), "AgentOS");
  await fsp.mkdir(base, { recursive: true });
  const name = slugify(m.repo.name) || "project";
  let dir = path.join(base, name);
  for (let n = 2; fs.existsSync(dir); n++) {
    const top = await topOf(dir);
    if (
      top &&
      m.repo.remote &&
      sameRemote(await originOf(top), m.repo.remote)
    ) {
      return { repo: top, mode: "existing" };
    }
    dir = path.join(base, `${name}-${n}`);
  }
  if (m.repo.remote && cloneable(m.repo.remote)) {
    try {
      await execFileAsync(
        "git",
        ["clone", "--quiet", "--", m.repo.remote, dir],
        {
          timeout: LONG_MS,
          // Never waits at a password prompt nobody sees
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
          },
        }
      );
      return { repo: fs.realpathSync(dir), mode: "cloned" };
    } catch (error) {
      console.error("[session-move] clone:", message(error));
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }
  // No remote, or this machine can't read it: the whole history comes over
  await fsp.mkdir(dir, { recursive: true });
  await git(["init", "--quiet"], { cwd: dir });
  if (m.repo.remote && cloneable(m.repo.remote)) {
    await git(["remote", "add", "origin", m.repo.remote], { cwd: dir });
  }
  return { repo: fs.realpathSync(dir), mode: "empty" };
}

async function prepare(inn: Arriving): Promise<void> {
  const m = inn.manifest;
  const existing = getSession(m.sessionId);
  if (existing) {
    const went = parseMovedTo(existing.moved_to);
    if (!isSettled(existing) || !went) {
      throw new Error("This session is already on this machine");
    }
    if (
      went.machine !== inn.from.machine ||
      (existing.claude_session_id &&
        existing.claude_session_id !== m.claudeSessionId)
    ) {
      throw new Error(
        `This session went to ${went.name}; it can only come back from there`
      );
    }
    const top = await topOf(sessionCwd(existing));
    if (top) {
      inn.repo = top;
      inn.mode = "return";
    }
  }
  if (!inn.repo) {
    const found = m.repo.remote ? await findCheckout(m.repo.remote) : null;
    if (found) {
      inn.repo = found;
      inn.mode = "existing";
    } else {
      const made = await cloneOrInit(m);
      inn.repo = made.repo;
      inn.mode = made.mode;
    }
  }
  const have: string[] = [];
  if (inn.mode !== "empty") {
    if (await has(inn.repo, `${m.repo.head}^{commit}`)) have.push(m.repo.head);
    const refs = await git(
      [
        "for-each-ref",
        "--format=%(objectname) %(objecttype)",
        "refs/remotes",
        "refs/heads",
      ],
      { cwd: inn.repo }
    );
    for (const line of refs.split("\n")) {
      const [sha, type] = line.split(" ");
      if (type === "commit" && !have.includes(sha) && have.length < HAVE_MAX) {
        have.push(sha);
      }
    }
  }
  inn.state = { moveId: m.moveId, phase: "ready", have };
}

/** Starts getting this machine ready; poll moveInState */
export async function prepareMoveIn(
  manifest: unknown,
  from: { machine: string; name: string },
  self: { machine: string; name: string }
): Promise<MoveInState> {
  if (!validManifest(manifest)) throw new Error("Not a session to continue");
  if (arriving.has(manifest.moveId)) throw new Error("Already arriving");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentos-move-in-"));
  const inn: Arriving = {
    manifest,
    from,
    self,
    dir,
    state: { moveId: manifest.moveId, phase: "preparing" },
  };
  arriving.set(manifest.moveId, inn);
  prepare(inn).catch((error) => {
    console.error("[session-move] prepare:", error);
    inn.state = {
      moveId: manifest.moveId,
      phase: "failed",
      error: message(error),
    };
  });
  return inn.state;
}

function arrivingOf(moveId: string): Arriving {
  const inn = MOVE_ID.test(moveId) ? arriving.get(moveId) : undefined;
  if (!inn) throw new Error("No such move");
  return inn;
}

export const moveInState = (moveId: string): MoveInState =>
  arrivingOf(moveId).state;

/** Stores one of the two files the hub pipes over */
export async function receiveMoveFile(
  moveId: string,
  kind: "bundle" | "transcript",
  body: ReadableStream<Uint8Array> | null
): Promise<number> {
  const inn = arrivingOf(moveId);
  if (inn.state.phase !== "ready") throw new Error("Not ready for it");
  if (!body) throw new Error("Nothing was sent");
  const file = path.join(inn.dir, kind);
  await pipeline(
    Readable.fromWeb(body as import("stream/web").ReadableStream),
    capped(kind === "bundle" ? BUNDLE_MAX : TRANSCRIPT_MAX),
    fs.createWriteStream(file)
  );
  return (await fsp.stat(file)).size;
}

/** Passes bytes through until there are more than `max` */
function capped(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      done(seen > max ? new Error("Too large to move") : null, chunk);
    },
  });
}

/**
 * Calls a move off; what a clone fetched stays. One that is already being
 * put in place stops at its next safe point, or finishes: `stopped` false
 * means poll moveInState for which ("failed" is stopped and undone)
 */
export async function cancelMoveIn(moveId: string): Promise<MoveInCancel> {
  const inn = arrivingOf(moveId);
  const phase = inn.state.phase;
  if (phase === "importing") {
    inn.cancelled = true;
    return { stopped: false, phase };
  }
  if (phase === "done") return { stopped: false, phase };
  arriving.delete(moveId);
  await fsp.rm(inn.dir, { recursive: true, force: true });
  return { stopped: true, phase };
}

async function branchValid(top: string, name: string): Promise<boolean> {
  if (!safeBranch(name)) return false;
  try {
    await git(["check-ref-format", "--branch", name], { cwd: top });
    return true;
  } catch {
    return false;
  }
}

async function revOf(top: string, ref: string): Promise<string | null> {
  return (
    (
      await git(["rev-parse", "--verify", "--quiet", ref], {
        cwd: top,
        okCodes: [0, 1],
      })
    ).trim() || null
  );
}

async function isAncestor(top: string, a: string, b: string): Promise<boolean> {
  try {
    return (await git(["merge-base", a, b], { cwd: top })).trim() === a;
  } catch {
    return false;
  }
}

interface Placed {
  /** The checkout's top folder */
  top: string;
  branch: string | null;
  renamedFrom?: string;
  /** An AgentOS worktree made for it */
  worktree: boolean;
}

/** The folder a returning session left, when nothing else changed in it */
async function reuseFolder(
  inn: Arriving,
  existing: Session
): Promise<Placed | null> {
  const m = inn.manifest;
  const top = inn.repo!;
  const state = await readWorkingTree(top);
  if (!state || state.staged) return null;
  const went = parseMovedTo(existing.moved_to);
  // Someone switched branches in it since
  if (went?.branch !== undefined && state.branch !== went.branch) return null;
  if (
    state.head !== m.repo.head &&
    !(await isAncestor(top, state.head, m.repo.head))
  ) {
    return null;
  }
  const left = went?.snapshot ?? null;
  if (state.uncommitted.length > 0) {
    // Only the changes it left with: they went along, and come back newer
    if (!left || left.skipped.length > 0 || state.head !== left.head) {
      return null;
    }
    const mine = new Set(left.paths.map((p) => p.path));
    if (!state.uncommitted.every((file) => mine.has(file.path))) return null;
    if (!(await verifyMaterialised(left, top))) return null;
    if ((await cleanSource(top, left)).length > 0) return null;
  }
  if (state.head !== m.repo.head) {
    try {
      await git(
        state.branch
          ? ["merge", "--ff-only", "--quiet", m.repo.head]
          : ["checkout", "--quiet", "--detach", m.repo.head],
        { cwd: top, timeoutMs: LONG_MS }
      );
    } catch {
      return null;
    }
  }
  // Back on the branch it left from, whatever it was called elsewhere
  return { top, branch: state.branch, worktree: !!existing.worktree_path };
}

async function newWorktree(inn: Arriving): Promise<Placed> {
  const m = inn.manifest;
  const repo = inn.repo!;
  const wanted =
    m.repo.branch && (await branchValid(repo, m.repo.branch))
      ? m.repo.branch
      : null;
  const base = getWorktreesDir();
  await fsp.mkdir(base, { recursive: true });
  const dir = path.join(
    base,
    `${slugify(m.repo.name) || "project"}-${slugify(wanted ?? "moved") || "moved"}-${m.moveId.slice(0, 6)}`
  );
  const add = (args: string[]) =>
    git(["worktree", "add", "--quiet", ...args], {
      cwd: repo,
      timeoutMs: LONG_MS,
    });
  if (!wanted) {
    inn.made = { worktree: dir, branch: null };
    await add(["--detach", dir, m.repo.head]);
    return { top: fs.realpathSync(dir), branch: null, worktree: true };
  }
  const local = await revOf(repo, `refs/heads/${wanted}`);
  if (!local) {
    inn.made = { worktree: dir, branch: wanted };
    await add(["-b", wanted, dir, m.repo.head]);
    if (await revOf(repo, `refs/remotes/origin/${wanted}`)) {
      await git(
        ["branch", "--quiet", `--set-upstream-to=origin/${wanted}`, wanted],
        {
          cwd: repo,
        }
      ).catch(() => {});
    }
    return { top: fs.realpathSync(dir), branch: wanted, worktree: true };
  }
  const list = await git(["worktree", "list", "--porcelain"], { cwd: repo });
  const checkedOut = list.split("\n").includes(`branch refs/heads/${wanted}`);
  if (!checkedOut && (await isAncestor(repo, local, m.repo.head))) {
    inn.made = { worktree: dir, branch: null };
    await add([dir, wanted]);
    await git(["merge", "--ff-only", "--quiet", m.repo.head], {
      cwd: dir,
      timeoutMs: LONG_MS,
    });
    return { top: fs.realpathSync(dir), branch: wanted, worktree: true };
  }
  // The branch is in use here, or went another way: its own name
  const stem = `${wanted}-${slugify(inn.from.name).replace(/^the-/, "") || "moved"}`;
  let name = stem;
  for (let n = 2; await revOf(repo, `refs/heads/${name}`); n++) {
    name = `${stem}-${n}`;
  }
  inn.made = { worktree: dir, branch: name };
  await add(["-b", name, dir, m.repo.head]);
  return {
    top: fs.realpathSync(dir),
    branch: name,
    renamedFrom: wanted,
    worktree: true,
  };
}

async function place(inn: Arriving, existing: Session | null): Promise<Placed> {
  const m = inn.manifest;
  const repo = inn.repo!;
  if (inn.mode === "return" && existing) {
    const reused = await reuseFolder(inn, existing);
    if (reused) return reused;
    return newWorktree(inn);
  }
  if (inn.mode === "cloned" || inn.mode === "empty") {
    const branch =
      m.repo.branch && (await branchValid(repo, m.repo.branch))
        ? m.repo.branch
        : null;
    await git(
      branch
        ? ["checkout", "--quiet", "-B", branch, m.repo.head]
        : ["checkout", "--quiet", "--detach", m.repo.head],
      { cwd: repo, timeoutMs: LONG_MS }
    );
    if (branch && (await revOf(repo, `refs/remotes/origin/${branch}`))) {
      await git(["branch", "--quiet", `--set-upstream-to=origin/${branch}`], {
        cwd: repo,
      }).catch(() => {});
    }
    return { top: repo, branch, worktree: false };
  }
  return newWorktree(inn);
}

/** Unpacks the conversation under the folder's Claude project */
async function placeTranscript(inn: Arriving, folder: string): Promise<void> {
  const sid = inn.manifest.claudeSessionId;
  const file = path.join(inn.dir, "transcript");
  if (!fs.existsSync(file)) throw new Error("The conversation didn't arrive");
  const { stdout } = await execFileAsync("tar", ["-tzf", file], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const names = stdout.split("\n").filter(Boolean);
  const safe = (name: string) =>
    (name === `${sid}.jsonl` ||
      name === sid ||
      name === `${sid}/` ||
      name.startsWith(`${sid}/`)) &&
    !name.split("/").includes("..");
  if (!names.includes(`${sid}.jsonl`) || !names.every(safe)) {
    throw new Error("The conversation didn't arrive as expected");
  }
  // Its real size, before anything is written out
  await pipeline(
    fs.createReadStream(file),
    zlib.createGunzip(),
    capped(UNPACKED_MAX),
    async (source: AsyncIterable<Buffer>) => {
      for await (const _chunk of source) void _chunk;
    }
  );
  const owner = (queries.getAllSessions(getDb()).all() as Session[]).find(
    (s) => s.claude_session_id === sid && s.id !== inn.manifest.sessionId
  );
  if (owner) throw new Error("That conversation belongs to another session");
  const out = path.join(inn.dir, "conversation");
  await fsp.mkdir(out);
  await execFileAsync("tar", ["-xzf", file, "-C", out]);
  // Files and folders only: nothing that points elsewhere
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else if (!entry.isFile()) throw new Error("Unexpected file type");
    }
  };
  await walk(out);
  const dst = path.join(claudeDir(), "projects", projectDirFor(folder));
  await fsp.mkdir(dst, { recursive: true });
  await fsp.copyFile(
    path.join(out, `${sid}.jsonl`),
    path.join(dst, `${sid}.jsonl`)
  );
  const sub = path.join(out, sid);
  if (fs.existsSync(sub)) {
    await fsp.rm(path.join(dst, sid), { recursive: true, force: true });
    await fsp.cp(sub, path.join(dst, sid), { recursive: true });
  }
}

/** The project whose folder is this repository, else Uncategorized */
function projectFor(top: string, repo: string): string {
  const real = (dir: string) => {
    try {
      return fs.realpathSync(expandHome(dir));
    } catch {
      return null;
    }
  };
  const wanted = new Set([real(top), real(repo)]);
  for (const p of queries.getAllProjects(getDb()).all() as Project[]) {
    if (p.is_uncategorized || !p.working_directory) continue;
    const dir = real(p.working_directory);
    if (dir && wanted.has(dir)) return p.id;
  }
  return "uncategorized";
}

/** Removes the worktree and branch a failed arrival made here */
async function undoPlace(inn: Arriving, transcriptIn: string | null) {
  const made = inn.made;
  if (!made || !inn.repo) return;
  inn.made = undefined;
  if (transcriptIn) {
    // That folder was made for this move: so was its Claude project
    const sid = inn.manifest.claudeSessionId;
    const dst = path.join(claudeDir(), "projects", projectDirFor(transcriptIn));
    await fsp.rm(path.join(dst, `${sid}.jsonl`), { force: true });
    await fsp.rm(path.join(dst, sid), { recursive: true, force: true });
  }
  await git(["worktree", "remove", "--force", made.worktree], {
    cwd: inn.repo,
  }).catch(() => fsp.rm(made.worktree, { recursive: true, force: true }));
  await git(["worktree", "prune"], { cwd: inn.repo }).catch(() => {});
  if (made.branch) {
    await git(["branch", "-D", "--quiet", made.branch], {
      cwd: inn.repo,
    }).catch(() => {});
  }
}

/**
 * Claude's "trust this folder?" screen in a folder new to this machine:
 * answered when the folder it left was trusted, else reported
 */
async function trustScreen(
  session: Session,
  sourceTrusted: boolean
): Promise<boolean> {
  const pane = `=${tmuxNameOf(session)}:`;
  for (let i = 0; i < 16; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    let bottom: string;
    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-p",
        "-t",
        pane,
      ]);
      bottom = String(stdout).trimEnd().split("\n").slice(-20).join("\n");
    } catch {
      return false;
    }
    if (!TRUST_SCREEN.test(bottom)) continue;
    if (!sourceTrusted) return true;
    await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]).catch(
      () => {}
    );
    return false;
  }
  return false;
}

const SESSION_COLUMNS = [
  "name",
  "claude_session_id",
  "model",
  "model_pinned",
  "effort",
  "permission_mode",
  "auto_approve",
  "subagent_model",
  "subagent_own_first",
  "working_directory",
  "worktree_path",
  "branch_name",
  "moved_to",
  "moved_from",
  "settled_at",
  "settled_reason",
] as const;

async function runImport(inn: Arriving): Promise<MoveInResult> {
  const m = inn.manifest;
  const repo = inn.repo!;
  const stopIfCancelled = () => {
    if (inn.cancelled) throw new Error("The move was called off");
  };
  const bundle = path.join(inn.dir, "bundle");
  if (fs.existsSync(bundle) && (await fsp.stat(bundle)).size > 0) {
    await git(
      [
        "fetch",
        "--quiet",
        "--no-tags",
        bundle,
        `+refs/agent-os/${m.sessionId}/*:refs/agent-os/${m.sessionId}/*`,
      ],
      { cwd: repo, timeoutMs: LONG_MS }
    );
  }
  if (
    !(await has(repo, `${m.repo.head}^{commit}`)) ||
    (m.snapshot && !(await has(repo, `${m.snapshot.commit}^{commit}`)))
  ) {
    throw new Error("The code didn't arrive complete");
  }
  stopIfCancelled();

  const existing = getSession(m.sessionId);
  let transcriptIn: string | null = null;
  let wrote = false;
  const db = getDb();
  try {
    const placed = await place(inn, existing);
    if (m.snapshot) {
      await materialise(m.snapshot, "", placed.top);
      if (!(await verifyMaterialised(m.snapshot, placed.top))) {
        throw new Error("The uncommitted changes didn't arrive complete");
      }
    }
    const wantedFolder = path.join(placed.top, m.repo.subdir);
    await fsp.mkdir(wantedFolder, { recursive: true });
    const folder = fs.realpathSync(wantedFolder);
    if (folder !== placed.top && !folder.startsWith(placed.top + path.sep)) {
      throw new Error("Its folder isn't inside the repository");
    }
    await placeTranscript(inn, folder);
    if (inn.made) transcriptIn = folder;

    const from: MovedFrom = { ...inn.from, at: Date.now() };
    const row = arrivalRow(placed, folder, existing?.branch_name ?? null);
    const access = arrivalMode(m);
    // Past here it is this machine's session: the hub can no longer call
    // it off, only a failed start undoes it
    stopIfCancelled();
    db.transaction(() => {
      if (!existing) {
        queries
          .createSession(db)
          .run(
            m.sessionId,
            m.name,
            `claude-${m.sessionId}`,
            row.working_directory,
            null,
            m.model,
            m.systemPrompt,
            "sessions",
            "claude",
            0,
            0,
            projectFor(placed.top, repo)
          );
      }
      db.prepare(
        `UPDATE sessions SET name = ?, claude_session_id = ?, model = ?,
           model_pinned = ?, effort = ?, permission_mode = ?, auto_approve = 0,
           subagent_model = ?, subagent_own_first = ?, working_directory = ?,
           worktree_path = ?, branch_name = ?, moved_to = NULL, moved_from = ?,
           settled_at = NULL, settled_reason = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        m.name,
        m.claudeSessionId,
        m.model,
        m.modelPinned ? 1 : null,
        m.effort,
        access.mode,
        m.subagentModel,
        m.subagentOwnFirst ? 1 : null,
        row.working_directory,
        row.worktree_path,
        row.branch_name,
        JSON.stringify(from),
        existing ? UNSETTLED_REASON : null,
        m.sessionId
      );
    })();
    wrote = true;

    const leftBehind = m.snapshot?.skipped ?? [];
    const session = getSession(m.sessionId)!;
    const notice = arrivedNoticeText(
      inn.self.name,
      platformName(),
      folder,
      inn.from.name,
      leftBehind
    );
    // Claude must learn it moved either way: queued when this machine
    // queues messages, else as the first thing it is told
    const queued = flagOnFor("queue", session.id);
    await launchSession(session, queued ? undefined : notice);
    if (queued) {
      queueStore(db).enqueueFirst(session.id, {
        text: notice,
        kind: "message",
        origin: "system",
      });
    }
    const needsTrust = inn.made
      ? await trustScreen(session, m.sourceTrusted === true).catch(() => false)
      : false;
    inn.made = undefined;
    await git(
      ["update-ref", "-d", `refs/agent-os/${m.sessionId}/out-${m.moveId}`],
      { cwd: repo }
    ).catch(() => {});
    return {
      sessionId: m.sessionId,
      folder,
      branch: placed.branch,
      renamedFrom: placed.renamedFrom,
      leftBehind,
      fullAccessOff: access.fullAccessOff || undefined,
      needsTrust: needsTrust || undefined,
    };
  } catch (error) {
    if (wrote) {
      // It never started: this machine's row goes back to what it was
      try {
        if (existing) {
          db.prepare(
            `UPDATE sessions SET ${SESSION_COLUMNS.map((c) => `${c} = ?`).join(", ")},
               updated_at = datetime('now') WHERE id = ?`
          ).run(
            ...SESSION_COLUMNS.map(
              (c) => (existing as unknown as Record<string, unknown>)[c] ?? null
            ),
            m.sessionId
          );
        } else {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(m.sessionId);
        }
      } catch (e) {
        console.error("[session-move] undoing the row:", e);
      }
    }
    await undoPlace(inn, transcriptIn).catch((e) =>
      console.error("[session-move] undoing the folder:", e)
    );
    throw error;
  }
}

/** Unpacks and resumes; poll moveInState for "done" */
export function importMove(moveId: string): MoveInState {
  const inn = arrivingOf(moveId);
  if (inn.state.phase !== "ready") throw new Error("Not ready for it");
  inn.state = { moveId, phase: "importing" };
  runImport(inn)
    .then((result) => {
      inn.state = { moveId, phase: "done", result };
    })
    .catch((error) => {
      console.error("[session-move] import:", error);
      inn.state = {
        moveId,
        phase: "failed",
        error:
          error instanceof GitError
            ? "Git couldn't put the code in place on that machine"
            : message(error),
      };
    })
    .finally(() => {
      fsp.rm(inn.dir, { recursive: true, force: true }).catch(() => {});
      // Its state stays readable for the hub's last polls
      setTimeout(() => arriving.delete(moveId), 60 * 60_000).unref();
    });
  return inn.state;
}
