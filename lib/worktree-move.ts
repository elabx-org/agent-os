/**
 * Move a running session into a new git worktree (M5 U2, N-Worktree).
 * Server only. Same Agent-OS session id, same tmux session.
 *
 * Busy: the move is stored as a `kind='move'` queue item at the head of
 * the session's queue and runs at its next idle edge (runScheduledMove,
 * from the dispatcher); nothing is typed into the agent; Cancel until it
 * starts. Ready: it runs now. While it runs the session is held
 * (lib/worktree-moving.ts, readiness "moving"). Either way a running move
 * is a `sending` queue row whose payload records its progress, so a
 * restart can check the source and put it back (recoverMove).
 *
 * Flow: (1) snapshot the source (lib/worktree-move-git.ts); (2) create the
 * worktree from HEAD with the exact branch and folder (lib/worktrees.ts);
 * (3) takeChanges: materialise + verify, then clean the snapshot's paths in
 * the source unless other live sessions use that folder (or the snapshot
 * skipped files); staged changes refuse the move; (4) Claude: `/exit` at
 * idle, wait for the process to end (C-c after 10s), copy (never move)
 * <projectDirFor(old)>/<sid>.jsonl and <sid>/ to projectDirFor(new) and
 * verify sizes, update working_directory, worktree_path, branch_name,
 * base_branch in one transaction, relaunch in the same tmux with
 * `respawn-pane -k -c <worktree>` and `--resume <sid>`, queue
 * movedNoticeText first. Not ready within 60s: restore the row, respawn in
 * the old folder with --resume, keep the worktree, report it. Others: the
 * M4 handoff path in place (summary as first message, fresh agent in the
 * worktree); (5) M3 setup steps (lib/env-setup.ts setupWorktree) in the
 * background, once the session has moved. Any failure before the relaunch
 * restores the source from the snapshot and removes the worktree.
 */

import { execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import type Database from "better-sqlite3";
import { getDb, queries, type Session } from "./db";
import { runInBackground } from "./async-operations";
import { claudeDir, projectDirFor } from "./claude-transcript";
import { setupWorktree } from "./env-setup";
import { flagOnFor } from "./flags";
import { workFolder } from "./handoff";
import type { SessionSummary } from "./handoff-types";
import { findAvailablePort } from "./ports";
import { getProviderDefinition, type ProviderId } from "./providers/registry";
import { withSessionLock } from "./queue/dispatcher";
import { queueStore, type QueueStore } from "./queue/store";
import type { QueueItem } from "./queue/types";
import { readiness, type Readiness } from "./session-ready";
import {
  buildLaunchCommand,
  isRunning,
  tmuxNameOf,
  type LaunchCommand,
} from "./session-launch";
import { buildSummary } from "./summarize";
import { sendText } from "./tmux-send";
import { locateTranscript, type LocatedTranscript } from "./transcript-locate";
import * as moveGit from "./worktree-move-git";
import type { MoveSnapshot, WorkingTreeState } from "./worktree-move-git";
import {
  decodeMovePayload,
  encodeMovePayload,
  moveModeFor,
  movedNoticeText,
  type CancelMoveResult,
  type MoveError,
  type MoveMode,
  type MovePreview,
  type MoveQueuePayload,
  type MoveRefusal,
  type MoveRequest,
  type MoveResult,
  type MoveState,
  type OtherSession,
} from "./worktree-move-types";
import { clearMoving, isMoving, markMoving } from "./worktree-moving";
import { createWorktree, deleteWorktree } from "./worktrees";
import type { CreateWorktreeOptions } from "./worktrees";

const execFileAsync = promisify(execFile);

/** A refusal the routes turn into its status and MoveError body */
export class MoveRefused extends Error {
  constructor(
    readonly status: number,
    readonly body: MoveError
  ) {
    super(body.error);
  }
}

/** A move that failed and was rolled back; the worktree kept, if it was */
export class MoveFailed extends Error {
  constructor(
    message: string,
    readonly keptWorktree: string | null = null
  ) {
    super(message);
  }
}

const REFUSALS: Record<MoveRefusal, [number, string]> = {
  staged: [409, "Unstage or commit first"],
  native_worktree: [
    400,
    "This session works in Claude's own worktree; it can't be moved yet",
  ],
  already_worktree: [400, "This session already works in a worktree"],
  not_git: [400, "This folder isn't in a git repository"],
  paused: [409, "This session is paused; resume it first"],
  in_progress: [409, "A move is already scheduled or under way"],
  bad_branch: [400, "Not a valid name for a new branch"],
  branch_exists: [409, "That branch already exists"],
  bad_folder: [
    400,
    "The folder must be an absolute path (or start with ~/) outside the repository",
  ],
  folder_exists: [409, "That folder already exists"],
  no_transcript: [400, "No Claude conversation to resume yet"],
  not_agent: [400, "Only an agent's session can be moved"],
  not_scheduled: [404, "No move is scheduled"],
  started: [409, "The move has already started"],
};

export function refused(reason: MoveRefusal, error?: string): MoveRefused {
  const [status, message] = REFUSALS[reason];
  return new MoveRefused(status, { error: error ?? message, reason });
}

/** Claude's `/exit` gets this long before C-c */
const STOP_MS = 10_000;
/** After each C-c */
const CTRL_C_MS = 5_000;
/** How long the relaunched agent gets to reach its prompt */
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 500;
/** Between the two reads that must agree */
const CONFIRM_MS = 500;
/** How long a failed move stays listed */
const FAILED_FOR_MS = 60 * 60 * 1000;

/** The git side (lib/worktree-move-git.ts, M5 U1), plus a branch lookup */
export interface MoveGit {
  readWorkingTree(cwd: string): Promise<WorkingTreeState | null>;
  isValidBranchName(cwd: string, branch: string): Promise<boolean>;
  branchExists(cwd: string, branch: string): Promise<boolean>;
  suggestBranch(cwd: string, sessionName: string): Promise<string>;
  suggestFolder(repoName: string, branch: string): string;
  snapshotForMove(cwd: string, sessionId: string): Promise<MoveSnapshot>;
  materialise(
    snapshot: MoveSnapshot,
    sourceCwd: string,
    worktreePath: string
  ): Promise<void>;
  verifyMaterialised(
    snapshot: MoveSnapshot,
    worktreePath: string
  ): Promise<boolean>;
  /** Paths left alone because they changed since the snapshot */
  cleanSource(cwd: string, snapshot: MoveSnapshot): Promise<string[] | void>;
  restoreSource(cwd: string, snapshot: MoveSnapshot): Promise<void>;
  dropSnapshot(cwd: string, snapshot: MoveSnapshot): Promise<void>;
}

/** Runs tmux with these arguments (argv only) */
export type MoveTmux = (args: string[]) => Promise<{ stdout: string }>;

/** What the move touches, so the tests can run it without tmux or git */
export interface WorktreeMoveDeps {
  db: Database.Database;
  store: QueueStore;
  now(): number;
  sleep(ms: number): Promise<void>;
  home(): string;
  git: MoveGit;
  createWorktree(options: CreateWorktreeOptions): Promise<unknown>;
  /** Removes the worktree and deletes its branch */
  deleteWorktree(worktreePath: string, projectPath: string): Promise<void>;
  exists(p: string): boolean;
  isRunning(session: Session): Promise<boolean>;
  /** The move's own reads (duringMove: its hold doesn't count) */
  readiness(session: Session): Promise<Readiness>;
  /** Runs `fn` under the session's dispatcher lock */
  withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
  queueOn(sessionId: string): boolean;
  locateTranscript(session: Session): Promise<LocatedTranscript | null>;
  /** Copies a Claude transcript (and its folder); returns what it created */
  copyTranscript(
    sid: string,
    file: string | null,
    fromCwd: string,
    toCwd: string
  ): Promise<string[]>;
  /**
   * Other live, unpaused sessions working anywhere in the same repository
   * (`toplevel`, its subfolders included): the snapshot and the clean
   * cover the whole repository
   */
  otherSessions(session: Session, toplevel: string): Promise<OtherSession[]>;
  /**
   * The relaunched agent shows the folder trust screen: accepts it (Enter)
   * when `sourceCwd` was trusted. True when it pressed Enter
   */
  acceptTrust?(session: Session, sourceCwd: string): Promise<boolean>;
  /** M3 setup steps in the background (trust honoured by setupWorktree) */
  setup(options: {
    sessionId: string;
    worktreePath: string;
    sourcePath: string;
    port: number | null;
    projectId: string | null;
  }): void;
  findPort(): Promise<number>;
  tmux: MoveTmux;
  /** Types text in (lib/tmux-send.ts) */
  sendText(session: Session, text: string): Promise<void>;
  /** lib/session-launch.ts buildLaunchCommand */
  launchCommand(session: Session): Promise<LaunchCommand>;
  summarize(session: Session): Promise<SessionSummary>;
  /** Moving and failed moves (scheduled ones come from the queue) */
  states: Map<string, MoveState>;
}

/** What a running move has done so far, kept in its queue row's payload */
export interface MoveProgress {
  toplevel: string;
  oldCwd: string;
  snapshot: MoveSnapshot | null;
  cleaned: boolean;
  rowMoved: boolean;
}

type ProgressPayload = MoveQueuePayload & { progress?: MoveProgress };

/** The row fields a move changes, kept for its rollback */
interface RowFields {
  working_directory: string;
  worktree_path: string | null;
  branch_name: string | null;
  base_branch: string | null;
  dev_server_port: number | null;
  claude_session_id: string | null;
}

interface Plan {
  branch: string;
  worktreePath: string;
  takeChanges: boolean;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copies <claudeDir>/projects/<projectDirFor(from)>/<sid>.jsonl and its
 * <sid>/ folder to projectDirFor(to) and checks the sizes. A copy of the
 * same conversation left there by an earlier, failed move is replaced (the
 * source's is the one the session went on with). Returns the paths written
 */
export async function copyClaudeTranscript(
  root: string,
  sid: string,
  file: string | null,
  fromCwd: string,
  toCwd: string
): Promise<string[]> {
  const projects = path.join(root, "projects");
  const src =
    file && fs.existsSync(file)
      ? file
      : path.join(projects, projectDirFor(fromCwd), `${sid}.jsonl`);
  if (!fs.existsSync(src)) {
    throw new Error("Claude hasn't written this conversation yet");
  }
  const dstDir = path.join(projects, projectDirFor(toCwd));
  const dst = path.join(dstDir, `${sid}.jsonl`);
  const created: string[] = [];
  try {
    await fsp.mkdir(dstDir, { recursive: true });
    await fsp.copyFile(src, dst);
    created.push(dst);
    if ((await fsp.stat(src)).size !== (await fsp.stat(dst)).size) {
      throw new Error("The copied conversation doesn't match");
    }
    const srcSub = path.join(path.dirname(src), sid);
    if (fs.existsSync(srcSub)) {
      const dstSub = path.join(dstDir, sid);
      await fsp.rm(dstSub, { recursive: true, force: true });
      await fsp.cp(srcSub, dstSub, { recursive: true });
      created.push(dstSub);
      if ((await treeSize(srcSub)) !== (await treeSize(dstSub))) {
        throw new Error("The copied conversation folder doesn't match");
      }
    }
    return created;
  } catch (error) {
    await removeAll(created);
    throw error;
  }
}

async function treeSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await treeSize(p);
    else if (entry.isFile()) total += (await fsp.stat(p)).size;
  }
  return total;
}

async function removeAll(paths: string[]): Promise<void> {
  for (const p of paths) {
    await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

export function createWorktreeMove(deps: WorktreeMoveDeps) {
  const { db, store, git, states } = deps;
  const inFlight = new Set<string>();

  const getSession = (id: string): Session | null =>
    (queries.getSession(db).get(id) as Session | undefined) ?? null;

  const moveRow = db.prepare(
    // updated_at stays: the session keeps its place in Now
    `UPDATE sessions SET working_directory = ?, worktree_path = ?,
       branch_name = ?, base_branch = ?, dev_server_port = ?,
       claude_session_id = ?
     WHERE id = ?`
  );
  const writeRow = (id: string, f: RowFields) =>
    db.transaction(() => {
      moveRow.run(
        f.working_directory,
        f.worktree_path,
        f.branch_name,
        f.base_branch,
        f.dev_server_port,
        f.claude_session_id,
        id
      );
    })();
  const rowOf = (s: Session): RowFields => ({
    working_directory: s.working_directory,
    worktree_path: s.worktree_path,
    branch_name: s.branch_name,
    base_branch: s.base_branch,
    dev_server_port: s.dev_server_port,
    claude_session_id: s.claude_session_id,
  });

  const paneOf = (s: Session) => `=${tmuxNameOf(s)}:`;

  function expand(dir: string): string {
    if (dir === "~") return deps.home();
    if (dir.startsWith("~/")) return path.join(deps.home(), dir.slice(2));
    return dir;
  }

  function display(dir: string): string {
    const home = deps.home();
    if (dir === home) return "~";
    return dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
  }

  /** An absolute (or ~/) folder, normalised; null when not allowed */
  function resolveFolder(input: string): string | null {
    const t = input.trim();
    if (!t || t.includes("\0")) return null;
    let p: string;
    if (t.startsWith("~/")) p = path.join(deps.home(), t.slice(2));
    else if (path.isAbsolute(t)) p = t;
    else return null;
    p = path.resolve(p);
    if (p === path.parse(p).root || p === path.resolve(deps.home())) {
      return null;
    }
    return p;
  }

  const inside = (p: string, dir: string) =>
    p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

  /** The refusals that don't depend on the request */
  async function baseRefusal(session: Session): Promise<MoveRefusal | null> {
    if (session.paused_at) return "paused";
    // A shell has no conversation to carry, and respawning it kills its job
    if ((session.agent_type || "claude") === "shell") return "not_agent";
    let worktreeFlag: string | undefined;
    try {
      worktreeFlag = getProviderDefinition(
        (session.agent_type || "claude") as ProviderId
      ).worktreeFlag;
    } catch {
      worktreeFlag = undefined;
    }
    if (session.branch_name && !session.worktree_path && worktreeFlag) {
      return "native_worktree";
    }
    if (session.worktree_path) return "already_worktree";
    if (
      moveModeFor(session.agent_type) === "resumed" &&
      !session.claude_session_id &&
      !(await deps.locateTranscript(session).catch(() => null))
    ) {
      return "no_transcript";
    }
    return null;
  }

  const moveInProgress = (id: string) =>
    inFlight.has(id) ||
    isMoving(id) ||
    !!store.moveItem(id) ||
    states.get(id)?.phase === "moving";

  /** Checks a request against the session and its checkout */
  async function validate(
    session: Session,
    request: Partial<MoveRequest> | null
  ): Promise<{ wt: WorkingTreeState; plan: Plan }> {
    if (!request || typeof request.branch !== "string") {
      throw refused("bad_branch");
    }
    if (typeof request.takeChanges !== "boolean") {
      throw new MoveRefused(400, {
        error: "takeChanges must be true or false",
      });
    }
    if (
      request.folder !== undefined &&
      request.folder !== null &&
      typeof request.folder !== "string"
    ) {
      throw refused("bad_folder");
    }
    const base = await baseRefusal(session);
    if (base) throw refused(base);
    const cwd = workFolder(session);
    const wt = await git.readWorkingTree(cwd).catch(() => null);
    if (!wt) throw refused("not_git");
    if (wt.staged) throw refused("staged");

    const branch = request.branch.trim();
    if (!branch || !(await git.isValidBranchName(wt.toplevel, branch))) {
      throw refused("bad_branch");
    }
    if (await git.branchExists(wt.toplevel, branch)) {
      throw refused("branch_exists");
    }
    const folder = request.folder?.trim()
      ? resolveFolder(request.folder)
      : git.suggestFolder(path.basename(wt.toplevel), branch);
    if (
      !folder ||
      inside(folder, path.resolve(wt.toplevel)) ||
      inside(folder, cwd)
    ) {
      throw refused("bad_folder");
    }
    if (deps.exists(folder)) throw refused("folder_exists");
    return {
      wt,
      plan: { branch, worktreePath: folder, takeChanges: request.takeChanges },
    };
  }

  async function movePreview(session: Session): Promise<MovePreview> {
    const cwd = workFolder(session);
    const agentType = session.agent_type || "claude";
    const mode = moveModeFor(agentType);
    const wt = await git.readWorkingTree(cwd).catch(() => null);
    const base = await baseRefusal(session);
    const reason: MoveRefusal | null = base ?? (wt ? null : "not_git");

    const running = !session.paused_at && (await deps.isRunning(session));
    const busy = running && !(await deps.readiness(session)).ready;
    const repoName = path.basename(wt?.toplevel ?? cwd);
    let suggestedBranch = "";
    let folder = "";
    if (wt) {
      suggestedBranch = await git
        .suggestBranch(wt.toplevel, session.name)
        .catch(() => "");
      if (suggestedBranch) {
        folder = git.suggestFolder(repoName, suggestedBranch);
      }
    }
    return {
      uncommitted: wt?.uncommitted ?? [],
      suggestedBranch,
      folder,
      folderDisplay: folder ? display(folder) : "",
      staged: wt?.staged ?? false,
      otherSessions: wt ? await deps.otherSessions(session, wt.toplevel) : [],
      repoName,
      currentBranch: wt?.branch ?? null,
      busy,
      mode,
      agentType,
      refusal: reason ? refused(reason).body : null,
      pending: moveStateOf(session.id),
    };
  }

  function stateFor(
    session: Session,
    plan: Plan,
    phase: MoveState["phase"],
    extra: Partial<MoveState> = {}
  ): MoveState {
    return {
      sessionId: session.id,
      phase,
      branch: plan.branch,
      worktreePath: plan.worktreePath,
      takeChanges: plan.takeChanges,
      mode: moveModeFor(session.agent_type),
      queueItemId: null,
      at: deps.now(),
      error: null,
      keptWorktree: null,
      ...extra,
    };
  }

  async function moveToWorktree(
    session: Session,
    request: MoveRequest
  ): Promise<MoveResult> {
    const id = session.id;
    if (moveInProgress(id)) throw refused("in_progress");
    inFlight.add(id);
    try {
      const { plan } = await validate(session, request);
      const mode = moveModeFor(session.agent_type);
      const payload: MoveQueuePayload = {
        v: 1,
        request: {
          branch: plan.branch,
          folder: plan.worktreePath,
          takeChanges: plan.takeChanges,
        },
        worktreePath: plan.worktreePath,
        scheduledAt: deps.now(),
      };
      // Under the dispatcher's lock: no queued paste is half-way in when the
      // session is held, and none starts after
      const claimed = await deps.withLock(id, async () => {
        if (isMoving(id) || store.moveItem(id)) throw refused("in_progress");
        markMoving(id);
        try {
          const running = await deps.isRunning(session);
          const ready = !running || (await deps.readiness(session)).ready;
          if (!ready) {
            const item = store.scheduleMove(id, encodeMovePayload(payload));
            if (!item) throw refused("in_progress");
            clearMoving(id);
            return { scheduled: true as const, item };
          }
          const item = store.startMove(id, encodeMovePayload(payload));
          if (!item) throw refused("in_progress");
          return { scheduled: false as const, item };
        } catch (error) {
          clearMoving(id);
          throw error;
        }
      });

      if (claimed.scheduled) {
        // A new move replaces an old failure
        states.delete(id);
        return {
          worktreePath: plan.worktreePath,
          branch: plan.branch,
          mode,
          scheduled: true,
          session: getSession(id) ?? session,
          sourceKept: false,
        };
      }
      try {
        const result = await runTracked(session, plan, claimed.item);
        store.markSent(id, claimed.item.id);
        return result;
      } catch (error) {
        store.markFailed(id, claimed.item.id, message(error));
        throw error;
      } finally {
        clearMoving(id);
      }
    } finally {
      inFlight.delete(id);
    }
  }

  /** Runs a move and keeps its state: moving, then gone or failed */
  async function runTracked(
    session: Session,
    plan: Plan,
    item: QueueItem
  ): Promise<MoveResult> {
    states.set(session.id, stateFor(session, plan, "moving"));
    try {
      const result = await execute(session, plan, item);
      states.delete(session.id);
      return result;
    } catch (error) {
      states.set(
        session.id,
        stateFor(session, plan, "failed", {
          error: message(error),
          keptWorktree: error instanceof MoveFailed ? error.keptWorktree : null,
        })
      );
      throw error;
    }
  }

  async function paneDead(session: Session): Promise<boolean> {
    try {
      const { stdout } = await deps.tmux([
        "display-message",
        "-p",
        "-t",
        paneOf(session),
        "#{pane_dead}",
      ]);
      return stdout.trim() === "1";
    } catch {
      // The tmux session is gone: nothing runs there either
      return true;
    }
  }

  async function waitDead(session: Session, ms: number): Promise<boolean> {
    const until = deps.now() + ms;
    for (;;) {
      if (await paneDead(session)) return true;
      if (deps.now() >= until) return false;
      await deps.sleep(POLL_MS);
    }
  }

  const keepPane = (session: Session, on: boolean) =>
    deps
      .tmux(
        on
          ? ["set-option", "-w", "-t", paneOf(session), "remain-on-exit", "on"]
          : ["set-option", "-w", "-u", "-t", paneOf(session), "remain-on-exit"]
      )
      .catch(() => {});

  /**
   * Ends Claude so its transcript is flushed and no longer written: the
   * pane stays (remain-on-exit) for the relaunch
   */
  async function stopClaude(session: Session): Promise<void> {
    await keepPane(session, true);
    if (!(await deps.readiness(session)).ready) {
      throw new Error("Claude isn't at its prompt");
    }
    await deps.sendText(session, "/exit");
    if (await waitDead(session, STOP_MS)) return;
    for (let i = 0; i < 2; i++) {
      await deps.tmux(["send-keys", "-t", paneOf(session), "C-c"]);
      if (await waitDead(session, CTRL_C_MS)) return;
    }
    throw new Error("Claude didn't stop");
  }

  /**
   * Starts the session's agent in `cwd`, in its own tmux session: respawned
   * in place (killing what runs there), or a new tmux session if it ended
   */
  async function relaunch(session: Session, cwd: string): Promise<void> {
    const { command } = await deps.launchCommand(session);
    const cmd = command === null ? [] : [command];
    if (await deps.isRunning(session)) {
      // The pane must outlive an agent that exits at once, so the wait
      // below sees it fail instead of the tmux session vanishing
      await keepPane(session, true);
      await deps.tmux([
        "respawn-pane",
        "-k",
        "-t",
        paneOf(session),
        "-c",
        cwd,
        ...cmd,
      ]);
      return;
    }
    await deps.tmux([
      "new-session",
      "-d",
      "-s",
      tmuxNameOf(session),
      "-c",
      cwd,
      "-x",
      "200",
      "-y",
      "50",
      ...cmd,
    ]);
  }

  /**
   * Ready twice in a row before the deadline; false if it died or timed
   * out. A folder trust screen is accepted when `trustFrom` was trusted
   */
  async function waitReady(
    session: Session,
    until: number,
    trustFrom?: string
  ): Promise<boolean> {
    let readyOnce = false;
    let accepted = 0;
    while (deps.now() < until) {
      if (!(await deps.isRunning(session)) || (await paneDead(session))) {
        return false;
      }
      const { ready, holdReason } = await deps.readiness(session);
      if (ready && readyOnce) return true;
      if (
        holdReason === "asking" &&
        trustFrom &&
        deps.acceptTrust &&
        accepted < 2 &&
        (await deps.acceptTrust(session, trustFrom).catch(() => false))
      ) {
        accepted++;
      }
      readyOnce = ready;
      await deps.sleep(ready ? CONFIRM_MS : POLL_MS);
    }
    return false;
  }

  /**
   * The moved session's first message: queued ahead of the user's (sent at
   * its idle edge once the hold is gone), or typed in now when the queue is
   * off for it (it was just read ready twice)
   */
  async function sendFirst(session: Session, text: string): Promise<void> {
    if (deps.queueOn(session.id)) {
      store.enqueueFirst(session.id, {
        text,
        kind: "message",
        origin: "system",
      });
      return;
    }
    await deps.sendText(session, text);
  }

  async function execute(
    session: Session,
    plan: Plan,
    item: QueueItem
  ): Promise<MoveResult> {
    const id = session.id;
    const mode: MoveMode = moveModeFor(session.agent_type);
    const cwd = workFolder(session);
    const wt = await git.readWorkingTree(cwd).catch(() => null);
    if (!wt) throw refused("not_git");
    if (wt.staged) throw refused("staged");
    const top = wt.toplevel;
    const wtPath = plan.worktreePath;

    const payload: MoveQueuePayload = decodeMovePayload(item.text) ?? {
      v: 1,
      request: {
        branch: plan.branch,
        folder: wtPath,
        takeChanges: plan.takeChanges,
      },
      worktreePath: wtPath,
      scheduledAt: deps.now(),
    };
    const progress: MoveProgress = {
      toplevel: top,
      oldCwd: cwd,
      snapshot: null,
      cleaned: false,
      rowMoved: false,
    };
    const save = () => {
      const full: ProgressPayload = { ...payload, progress };
      store.setMoveText(id, item.id, JSON.stringify(full));
    };

    let snapshot: MoveSnapshot | null = null;
    let created = false;

    /**
     * Puts the source back and removes the worktree. Keeps the worktree
     * (and says so) when the source couldn't be restored: it then holds
     * the only other copy of the changes
     */
    const undoGit = async (): Promise<string | null> => {
      if (snapshot && progress.cleaned) {
        try {
          await git.restoreSource(top, snapshot);
        } catch (error) {
          console.error("[move] restoring the source:", error);
          return created ? wtPath : null;
        }
      }
      if (created) {
        await deps.deleteWorktree(wtPath, top).catch((error) => {
          console.error("[move] removing the worktree:", error);
        });
      }
      if (snapshot && !progress.cleaned) {
        await git.dropSnapshot(top, snapshot).catch(() => {});
      }
      return null;
    };
    const failGit = async (error: unknown): Promise<never> => {
      const kept = await undoGit();
      if (error instanceof MoveRefused && !kept) throw error;
      throw new MoveFailed(message(error), kept);
    };

    // (1)-(3) the worktree, with the changes when asked
    let sourceKept = false;
    try {
      snapshot = await git.snapshotForMove(top, id);
      progress.snapshot = snapshot;
      save();
      await deps.createWorktree({
        projectPath: top,
        featureName: plan.branch,
        branchName: plan.branch,
        worktreePath: wtPath,
        fromRef: "HEAD",
      });
      created = true;
      if (plan.takeChanges && snapshot.paths.length) {
        await git.materialise(snapshot, top, wtPath);
        if (!(await git.verifyMaterialised(snapshot, wtPath))) {
          throw new Error("The worktree doesn't match the changes");
        }
        const others = await deps.otherSessions(session, top);
        if (
          others.length ||
          snapshot.skipped.length ||
          // Written since the snapshot: that work is in neither copy
          !(await git.verifyMaterialised(snapshot, top))
        ) {
          sourceKept = true;
        } else {
          // Marked first: a clean that fails half-way is still undone
          progress.cleaned = true;
          save();
          const left = await git.cleanSource(top, snapshot);
          if (left && left.length) sourceKept = true;
        }
      }
    } catch (error) {
      return failGit(error);
    }

    // (4) the agent: stopped (Claude) and its row moved
    const running = await deps.isRunning(session);
    const old = rowOf(session);
    const port =
      session.dev_server_port ?? (await deps.findPort().catch(() => null));
    const target: RowFields = {
      working_directory: wtPath,
      worktree_path: wtPath,
      branch_name: plan.branch,
      base_branch: wt.branch,
      dev_server_port: port,
      claude_session_id: session.claude_session_id,
    };
    let stopping = false;
    let copies: string[] = [];
    let summary: SessionSummary | null = null;
    try {
      if (mode === "resumed") {
        const located = await deps.locateTranscript(session);
        const sid = located?.sessionId ?? session.claude_session_id;
        if (!sid) throw refused("no_transcript");
        if (running) {
          stopping = true;
          await stopClaude(session);
        }
        copies = await deps.copyTranscript(
          sid,
          located?.file ?? null,
          located?.cwd ?? cwd,
          wtPath
        );
        target.claude_session_id = sid;
      } else if (running) {
        summary = await deps.summarize(session).catch((error) => {
          console.error("[move] summary:", error);
          return null;
        });
      }
      writeRow(id, target);
      progress.rowMoved = true;
      save();
    } catch (error) {
      if (progress.rowMoved) writeRow(id, old);
      progress.rowMoved = false;
      await removeAll(copies);
      if (stopping) await restartOld(session, cwd);
      return failGit(error);
    }

    const moved = getSession(id)!;
    const from = display(cwd);
    const first =
      mode === "resumed" || !summary || summary.empty || !summary.text.trim()
        ? movedNoticeText(wtPath, plan.branch, from)
        : summary.text;

    // (4b) relaunched in the same tmux, in the worktree
    if (running) {
      let ready = false;
      try {
        await relaunch(moved, wtPath);
        ready = await waitReady(moved, deps.now() + READY_TIMEOUT_MS, cwd);
      } catch (error) {
        console.error("[move] relaunch:", error);
      }
      if (!ready) {
        writeRow(id, old);
        progress.rowMoved = false;
        save();
        const back = getSession(id)!;
        await relaunchOld(back, cwd);
        if (snapshot && progress.cleaned) {
          await git.restoreSource(top, snapshot).catch((error) => {
            console.error("[move] restoring the source:", error);
          });
        }
        throw new MoveFailed(
          mode === "resumed"
            ? "Claude didn't reach its prompt in the worktree; it is back in its folder"
            : "The agent didn't reach its prompt in the worktree; it is back in its folder",
          wtPath
        );
      }
      await keepPane(moved, false);
      await sendFirst(moved, first);
    } else if (deps.queueOn(id) && mode === "resumed") {
      // Not running: it hears where it is when it next starts
      store.enqueueFirst(id, {
        text: first,
        kind: "message",
        origin: "system",
      });
    }

    // (5) M3 setup steps
    deps.setup({
      sessionId: id,
      worktreePath: wtPath,
      sourcePath: top,
      port,
      projectId: session.project_id ?? null,
    });

    return {
      worktreePath: wtPath,
      branch: plan.branch,
      mode,
      scheduled: false,
      session: getSession(id) ?? moved,
      sourceKept,
    };
  }

  /** After a failed move: the agent back in its folder (resumed if Claude) */
  async function relaunchOld(session: Session, cwd: string): Promise<void> {
    try {
      await relaunch(session, cwd);
      await keepPane(session, false);
    } catch (error) {
      console.error("[move] relaunching in the old folder:", error);
    }
  }

  /** Claude was being stopped: started again in its folder if it ended */
  async function restartOld(session: Session, cwd: string): Promise<void> {
    if (await paneDead(session)) {
      await relaunchOld(getSession(session.id) ?? session, cwd);
    } else {
      await keepPane(session, false);
    }
  }

  /**
   * Runs a claimed `kind='move'` item (the dispatcher, after two ready
   * reads). Resolves when moved; throws with the reason when it failed and
   * was rolled back (the dispatcher marks the item failed)
   */
  async function runScheduledMove(
    session: Session,
    item: QueueItem
  ): Promise<void> {
    // Held before anything yields
    markMoving(session.id);
    try {
      const payload = decodeMovePayload(item.text);
      if (!payload) throw new Error("The scheduled move couldn't be read");
      const plan: Plan = {
        branch: payload.request.branch,
        worktreePath: payload.worktreePath,
        takeChanges: payload.request.takeChanges,
      };
      const fresh = getSession(session.id) ?? session;
      try {
        await validate(fresh, {
          ...payload.request,
          folder: payload.worktreePath,
        });
      } catch (error) {
        states.set(
          session.id,
          stateFor(fresh, plan, "failed", { error: message(error) })
        );
        throw error;
      }
      await runTracked(fresh, plan, item);
    } finally {
      clearMoving(session.id);
    }
  }

  /**
   * A move a restart cut off (its row already marked failed): the source
   * gets its changes back if they were cleaned and the session hadn't moved,
   * a dead pane is started again in its folder, and the failure is listed
   */
  async function recoverMove(item: QueueItem): Promise<void> {
    const payload = decodeMovePayload(item.text) as ProgressPayload | null;
    const session = getSession(item.sessionId);
    if (!payload || !session) return;
    const progress = payload.progress;
    if (progress?.rowMoved && workFolder(session) === payload.worktreePath) {
      // The session had moved: the move is done, only its agent may be down
      await finishMoved(session, progress);
      return;
    }
    if (
      progress?.snapshot &&
      progress.cleaned &&
      !progress.rowMoved &&
      workFolder(session) === progress.oldCwd
    ) {
      await git
        .restoreSource(progress.toplevel, progress.snapshot)
        .catch((error) => console.error("[move] restoring the source:", error));
    }
    if (
      !progress?.rowMoved &&
      !session.paused_at &&
      (await deps.isRunning(session)) &&
      (await paneDead(session))
    ) {
      await relaunchOld(session, workFolder(session));
    }
    const plan: Plan = {
      branch: payload.request.branch,
      worktreePath: payload.worktreePath,
      takeChanges: payload.request.takeChanges,
    };
    states.set(
      session.id,
      stateFor(session, plan, "failed", {
        error: "Cut off by a restart",
        keptWorktree: deps.exists(payload.worktreePath)
          ? payload.worktreePath
          : null,
      })
    );
  }

  /** A restart cut off a move after the row moved: the agent started there */
  async function finishMoved(
    session: Session,
    progress: MoveProgress
  ): Promise<void> {
    if (session.paused_at || !(await deps.isRunning(session))) return;
    if (!(await paneDead(session))) {
      await keepPane(session, false);
      return;
    }
    await relaunchOld(session, workFolder(session));
    if (
      deps.queueOn(session.id) &&
      moveModeFor(session.agent_type) === "resumed"
    ) {
      store.enqueueFirst(session.id, {
        text: movedNoticeText(
          workFolder(session),
          session.branch_name ?? "",
          display(progress.oldCwd)
        ),
        kind: "message",
        origin: "system",
      });
    }
  }

  async function cancelMove(session: Session): Promise<CancelMoveResult> {
    const item = store.moveItem(session.id);
    if (item?.status === "pending") {
      if (store.cancelItem(session.id, item.id)) return { cancelled: true };
      throw refused("started");
    }
    if (item || isMoving(session.id)) throw refused("started");
    throw refused("not_scheduled");
  }

  function listMoves(): MoveState[] {
    const out = new Map<string, MoveState>();
    for (const [id, state] of states) {
      if (state.phase === "failed" && deps.now() - state.at > FAILED_FOR_MS) {
        states.delete(id);
        continue;
      }
      out.set(id, state);
    }
    for (const item of store.pendingMoves()) {
      if (out.get(item.sessionId)?.phase === "moving") continue;
      const payload = decodeMovePayload(item.text);
      if (!payload) continue;
      const session = getSession(item.sessionId);
      out.set(item.sessionId, {
        sessionId: item.sessionId,
        phase: "scheduled",
        branch: payload.request.branch,
        worktreePath: payload.worktreePath,
        takeChanges: payload.request.takeChanges,
        mode: moveModeFor(session?.agent_type),
        queueItemId: item.id,
        at: payload.scheduledAt,
        error: null,
        keptWorktree: null,
      });
    }
    return [...out.values()];
  }

  function moveStateOf(sessionId: string): MoveState | null {
    return listMoves().find((m) => m.sessionId === sessionId) ?? null;
  }

  return {
    movePreview,
    moveToWorktree,
    cancelMove,
    listMoves,
    moveStateOf,
    runScheduledMove,
    recoverMove,
  };
}

export type WorktreeMove = ReturnType<typeof createWorktreeMove>;

// Shared by Next's copy of this module (the routes) and server.ts's (the
// dispatcher), like the hold
const shared = globalThis as unknown as {
  __agentosMoveStates?: Map<string, MoveState>;
};

const liveGit: MoveGit = {
  readWorkingTree: moveGit.readWorkingTree,
  isValidBranchName: moveGit.isValidBranchName,
  branchExists: moveGit.branchTaken,
  suggestBranch: moveGit.suggestBranch,
  suggestFolder: moveGit.suggestFolder,
  snapshotForMove: moveGit.snapshotForMove,
  materialise: moveGit.materialise,
  verifyMaterialised: moveGit.verifyMaterialised,
  cleanSource: moveGit.cleanSource,
  restoreSource: moveGit.restoreSource,
  dropSnapshot: moveGit.dropSnapshot,
};

/** `folder` is the repository's top folder or inside it */
export function inRepository(folder: string, toplevel: string): boolean {
  const f = path.resolve(folder);
  const top = path.resolve(toplevel);
  return f === top || f.startsWith(top + path.sep);
}

/** Claude's folder trust screen (lib/session-ready.ts CLAUDE_DIALOGS) */
const TRUST_SCREEN =
  /trust (the files in |the contents of )?this (folder|directory|project)|Is this a project you created or one you trust/i;

/**
 * Claude trusts `cwd` (or a folder above it) in its config: read only,
 * never written (Claude rewrites that file itself)
 */
export async function folderTrusted(
  cwd: string,
  files = [
    path.join(claudeDir(), ".claude.json"),
    path.join(os.homedir(), ".claude.json"),
  ]
): Promise<boolean> {
  const dir = path.resolve(cwd);
  for (const file of files) {
    let projects: Record<string, { hasTrustDialogAccepted?: boolean }>;
    try {
      projects = JSON.parse(await fsp.readFile(file, "utf8"))?.projects ?? {};
    } catch {
      continue;
    }
    for (const [folder, entry] of Object.entries(projects)) {
      if (!entry?.hasTrustDialogAccepted) continue;
      const f = path.resolve(folder);
      if (dir === f || dir.startsWith(f.endsWith(path.sep) ? f : f + path.sep))
        return true;
    }
  }
  return false;
}

const liveDeps = (): WorktreeMoveDeps => {
  const db = getDb();
  return {
    db,
    store: queueStore(db),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    home: os.homedir,
    git: liveGit,
    createWorktree,
    deleteWorktree: (worktreePath, projectPath) =>
      deleteWorktree(worktreePath, projectPath, true),
    exists: fs.existsSync,
    isRunning,
    readiness: (session) => readiness(session, { duringMove: true }),
    withLock: withSessionLock,
    queueOn: (id) => flagOnFor("queue", id),
    locateTranscript,
    copyTranscript: (sid, file, fromCwd, toCwd) =>
      copyClaudeTranscript(claudeDir(), sid, file, fromCwd, toCwd),
    otherSessions: async (session, toplevel) => {
      const others = (queries.getAllSessions(db).all() as Session[]).filter(
        (s) =>
          s.id !== session.id &&
          !s.paused_at &&
          inRepository(workFolder(s), toplevel)
      );
      const live: OtherSession[] = [];
      for (const s of others) {
        if (await isRunning(s)) live.push({ id: s.id, name: s.name });
      }
      return live;
    },
    setup: ({ sessionId, worktreePath, sourcePath, port, projectId }) => {
      runInBackground(async () => {
        const result = await setupWorktree({
          worktreePath,
          sourcePath,
          port: port ?? undefined,
          projectId: projectId ?? undefined,
        });
        console.log("[move] worktree setup:", {
          envFilesCopied: result.envFilesCopied,
          stepsRun: result.steps.length,
          success: result.success,
        });
      }, `setup-worktree-${sessionId}`);
    },
    acceptTrust: async (session, sourceCwd) => {
      const pane = `=${tmuxNameOf(session)}:`;
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-p",
        "-t",
        pane,
      ]);
      const bottom = String(stdout).trimEnd().split("\n").slice(-20).join("\n");
      if (!TRUST_SCREEN.test(bottom)) return false;
      if (!(await folderTrusted(sourceCwd))) return false;
      await execFileAsync("tmux", ["send-keys", "-t", pane, "Enter"]);
      return true;
    },
    findPort: findAvailablePort,
    tmux: async (args) => {
      const { stdout } = await execFileAsync("tmux", args);
      return { stdout: String(stdout) };
    },
    sendText: (session, text) => sendText(session, text, { pressEnter: true }),
    launchCommand: (session) => buildLaunchCommand(session),
    summarize: (session) => buildSummary(session),
    states: (shared.__agentosMoveStates ??= new Map()),
  };
};

// One instance per module copy; the in-flight set guards double taps
let instance: WorktreeMove | null = null;
const live = () => (instance ??= createWorktreeMove(liveDeps()));

export async function movePreview(session: Session): Promise<MovePreview> {
  return live().movePreview(session);
}

/**
 * Validates, then runs now (ready) or schedules for the next idle edge
 * (busy). Throws MoveRefused
 */
export async function moveToWorktree(
  session: Session,
  request: MoveRequest
): Promise<MoveResult> {
  return live().moveToWorktree(session, request);
}

/** Cancels a scheduled move; MoveRefused not_scheduled / started */
export async function cancelMove(session: Session): Promise<CancelMoveResult> {
  return live().cancelMove(session);
}

/** Every scheduled, running or failed move (Now's "Moving…") */
export function listMoves(): MoveState[] {
  return live().listMoves();
}

/** One session's move state, null when none */
export function moveStateOf(sessionId: string): MoveState | null {
  return live().moveStateOf(sessionId);
}

/**
 * Runs a claimed `kind='move'` queue item (the dispatcher, after two ready
 * reads). Resolves when moved; throws with the reason when it failed and
 * was rolled back (the item is marked failed)
 */
export async function runScheduledMove(
  session: Session,
  item: QueueItem
): Promise<void> {
  return live().runScheduledMove(session, item);
}

/** A move cut off by a restart (lib/queue/dispatcher.ts startDispatcher) */
export async function recoverMove(item: QueueItem): Promise<void> {
  return live().recoverMove(item);
}
