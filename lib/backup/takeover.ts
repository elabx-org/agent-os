/**
 * Continuing a linked machine's session on the hub from its copy, while
 * that machine is offline (Settings, Machines, a copy, "Continue on …").
 * Server only. The arrival is an ordinary move-in (lib/session-move.ts)
 * with { takeover: true }: never cloned from a URL the copy names, no
 * remote asked, the trust screen never answered, always "Ask first".
 *
 * One copy at a time: the row is claimed atomically ('taking'), uploads
 * for it are refused meanwhile, and if the machine comes back before the
 * session is written here the take-over is called off. Once it stands the
 * row is 'taken', and the machine pauses its own the moment it connects.
 */

import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import type Database from "better-sqlite3";
import { getDb, queries, type Session } from "../db";
import { linkHub } from "../link/server";
import {
  machineById,
  machineCaps,
  serverName,
  type MachineRow,
} from "../link/store";
import { CAP_TAKE } from "../link/protocol";
import { serverNameOr } from "../server-name";
import {
  cancelMoveIn,
  importMove,
  moveInState,
  packBundle,
  prepareMoveIn,
  receiveMoveFile,
} from "../session-move";
import {
  parseMovedFrom,
  parseMovedTo,
  type MoveInState,
  type MoveManifest,
} from "../session-move-types";
import { git } from "../turns-git";
import {
  BACKUP_GIT_MS,
  BACKUP_LIMITS,
  backupRow,
  conversationFile,
  freeBytes,
  parseManifest,
  repoDir,
  type BackupRow,
} from "./store";
import { TAKE_WHY_NOT, type TakeJob } from "./types";

/** Offline at least this long before a copy may be continued */
export const OFFLINE_MS = 90_000;
const POLL_MS = 1000;
const PREPARE_MS = 20 * 60_000;
const IMPORT_MS = 40 * 60_000;

/**
 * AGENTOS_BACKUP_OFFLINE_MS shortens it for tests: it is the server's own
 * environment, which nothing on the link or in a page can set
 */
export const offlineNeeded = () => {
  const raw = process.env.AGENTOS_BACKUP_OFFLINE_MS;
  const ms = raw ? Number(raw) : NaN;
  return Number.isFinite(ms) && ms >= 0 ? ms : OFFLINE_MS;
};

export class TakeRefused extends Error {}

/** Why a copy can't be continued here; null when it can */
export function whyNotTake(input: {
  machine: Pick<MachineRow, "id" | "name" | "status" | "caps"> | null;
  online: boolean;
  offlineMs: number;
  row: BackupRow | null;
  hubSession: Pick<Session, "settled_at" | "moved_to"> | null;
  /** null: not asked yet (the list) */
  settingsOk: boolean | null;
  offlineNeeded?: number;
}): string | null {
  const { machine, row } = input;
  if (!machine || machine.status !== "approved" || !row) {
    return TAKE_WHY_NOT.noCopy;
  }
  if (row.state === "taking") return TAKE_WHY_NOT.taking;
  if (row.state === "taken") return TAKE_WHY_NOT.alreadyHere;
  if (!row.repo_key || !row.head) return TAKE_WHY_NOT.notGit;
  if (!machineCaps(machine).includes(CAP_TAKE)) {
    return TAKE_WHY_NOT.tooOld(machine.name);
  }
  if (input.online) return TAKE_WHY_NOT.online(machine.name);
  if (input.offlineMs < (input.offlineNeeded ?? OFFLINE_MS)) {
    return TAKE_WHY_NOT.justLeft(machine.name);
  }
  const here = input.hubSession;
  if (here) {
    const went = parseMovedTo(here.moved_to);
    if (!here.settled_at) return TAKE_WHY_NOT.alreadyHere;
    if (!went) return TAKE_WHY_NOT.movedNoAnswer;
    if (went.machine !== machine.id) return TAKE_WHY_NOT.alreadyHere;
  }
  if (row.has_settings === 1 && input.settingsOk === false) {
    return TAKE_WHY_NOT.settings;
  }
  return null;
}

/** What a take-over calls; tests replace them */
export interface TakeDeps {
  db: Database.Database;
  machine(id: string): MachineRow | null;
  online(id: string): boolean;
  offlineFor(id: string): number;
  tellTaken(id: string): void;
  hubName(): string;
  prepareMoveIn: typeof prepareMoveIn;
  moveInState: typeof moveInState;
  receiveMoveFile: typeof receiveMoveFile;
  importMove: typeof importMove;
  cancelMoveIn: typeof cancelMoveIn;
  /** The checked-out size of the copy's code, in bytes */
  codeBytes(row: BackupRow): Promise<number>;
  freeBytes(): Promise<number>;
  /** Pins the copy's commits by SHA; the refs to bundle */
  pin(row: BackupRow, takeId: string): Promise<string[]>;
  unpin(row: BackupRow, takeId: string): Promise<void>;
  /** A bundle of `refs` without `have`; null when nothing is needed */
  bundle(
    row: BackupRow,
    refs: string[],
    have: string[]
  ): Promise<string | null>;
  /** A tar of exactly the copy's conversation bytes */
  conversation(row: BackupRow): Promise<Readable>;
  /** The conversation copy, once it runs here */
  dropConversation(row: BackupRow): Promise<void>;
  sleep(ms: number): Promise<void>;
}

import { takes, type Running } from "./takes";

const hubSession = (db: Database.Database, id: string) =>
  (queries.getSession(db).get(id) as Session | undefined) ?? null;

function treeBytes(repo: string, commit: string): Promise<number> {
  return git(["ls-tree", "-r", "-l", "-z", commit], {
    cwd: repo,
    timeoutMs: BACKUP_GIT_MS,
  }).then((out) =>
    out
      .split("\0")
      .map((line) => Number(line.split(/\s+/)[3]))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0)
  );
}

const pinRefs = (row: BackupRow, takeId: string) => ({
  head: `refs/agent-os/${row.session_id}/out-${takeId}`,
  snap: `refs/agent-os/${row.session_id}/snap-${takeId}`,
});

export const liveTakeDeps = (): TakeDeps => ({
  db: getDb(),
  machine: machineById,
  online: (id) => linkHub().presence(id) === "online",
  offlineFor: (id) => linkHub().offlineFor(id),
  tellTaken: (id) => linkHub().tellTaken(id),
  hubName: () => serverNameOr(serverName()),
  prepareMoveIn,
  moveInState,
  receiveMoveFile,
  importMove,
  cancelMoveIn,
  codeBytes: async (row) => {
    const repo = repoDir(row.machine_id, row.repo_key!);
    const sizes = await Promise.all(
      [row.head, row.snapshot_commit]
        .filter((c): c is string => !!c)
        .map((c) => treeBytes(repo, c))
    );
    return Math.max(0, ...sizes);
  },
  freeBytes,
  pin: async (row, takeId) => {
    const repo = repoDir(row.machine_id, row.repo_key!);
    const refs = pinRefs(row, takeId);
    // By SHA, never by a ref the machine could have moved
    await git(["update-ref", refs.head, row.head!], { cwd: repo });
    if (!row.snapshot_commit) return [refs.head];
    await git(["update-ref", refs.snap, row.snapshot_commit], { cwd: repo });
    return [refs.head, refs.snap];
  },
  unpin: async (row, takeId) => {
    const repo = repoDir(row.machine_id, row.repo_key!);
    const refs = pinRefs(row, takeId);
    for (const ref of [refs.head, refs.snap]) {
      await git(["update-ref", "-d", ref], { cwd: repo }).catch(() => {});
    }
  },
  bundle: (row, refs, have) =>
    packBundle(
      repoDir(row.machine_id, row.repo_key!),
      refs,
      have,
      path.join(
        os.tmpdir(),
        `agentos-take-${row.session_id}-${randomBytes(4).toString("hex")}.bundle`
      )
    ),
  conversation: async (row) => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentos-take-"));
    const name = `${row.claude_session_id}.jsonl`;
    const src = conversationFile(row.machine_id, row.session_id, row.file_gen);
    // Exactly the bytes the row says: anything after is an upload not
    // yet committed
    const out = await fsp.open(path.join(dir, name), "wx", 0o600);
    try {
      if (row.file_bytes > 0) {
        await new Promise<void>((resolve, reject) => {
          fs.createReadStream(src, { start: 0, end: row.file_bytes - 1 })
            .on("error", reject)
            .pipe(out.createWriteStream())
            .on("error", reject)
            .on("finish", () => resolve());
        });
      }
    } finally {
      await out.close().catch(() => {});
    }
    const child = spawn("tar", ["-czf", "-", "-C", dir, name], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.on("close", (code) => {
      fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (code !== 0) {
        child.stdout.destroy(new Error("Packing the conversation failed"));
      }
    });
    return child.stdout;
  },
  dropConversation: async (row) => {
    await fsp.rm(
      conversationFile(row.machine_id, row.session_id, row.file_gen),
      { force: true }
    );
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

/** The manifest handed to the move-in: the copy, untrusted, asking first */
export function takeManifest(
  row: BackupRow,
  takeId: string
): MoveManifest | null {
  const stored = parseManifest(row);
  if (!stored?.repo || !row.head) return null;
  return {
    v: 1,
    moveId: takeId,
    sessionId: row.session_id,
    name: stored.name,
    claudeSessionId: row.claude_session_id,
    model: stored.model,
    modelPinned: stored.modelPinned,
    effort: stored.effort,
    permissionMode: "manual",
    autoApprove: false,
    subagentModel: stored.subagentModel,
    subagentOwnFirst: stored.subagentOwnFirst,
    systemPrompt: stored.systemPrompt,
    sourceTrusted: false,
    repo: { ...stored.repo, head: row.head },
    snapshot:
      stored.snapshot && row.snapshot_commit && row.snapshot_tree
        ? {
            ...stored.snapshot,
            ref: pinRefs(row, takeId).snap,
            commit: row.snapshot_commit,
            tree: row.snapshot_tree,
            head: row.head,
          }
        : null,
  };
}

async function waitFor(
  deps: TakeDeps,
  takeId: string,
  until: MoveInState["phase"][],
  ms: number,
  run: Running
): Promise<MoveInState> {
  const end = Date.now() + ms;
  for (;;) {
    let state: MoveInState;
    try {
      state = deps.moveInState(takeId);
    } catch {
      // Called off: its machine came back
      throw new Error(run.cameBack ? "came back" : "It stopped");
    }
    if (until.includes(state.phase)) return state;
    if (state.phase === "failed") {
      throw new Error(state.error || "It didn't start here");
    }
    if (Date.now() > end) throw new Error("It took too long");
    await deps.sleep(POLL_MS);
  }
}

const toWeb = (stream: Readable) =>
  Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

async function runTake(run: Running, row: BackupRow, deps: TakeDeps) {
  const { job, takeId } = run;
  const db = deps.db;
  let pinned = false;
  try {
    const manifest = takeManifest(row, takeId);
    if (!manifest) throw new Error(TAKE_WHY_NOT.notGit);
    const refs = await deps.pin(row, takeId);
    pinned = true;
    await deps.prepareMoveIn(
      manifest,
      {
        machine: row.machine_id,
        name: job.machineName,
        takeId,
        copyAt: row.copied_at,
      },
      { machine: "hub", name: job.hubName },
      { takeover: true }
    );
    const ready = await waitFor(deps, takeId, ["ready"], PREPARE_MS, run);
    if (run.cameBack) throw new Error("came back");

    job.step = "code";
    const bundle = await deps.bundle(row, refs, ready.have ?? []);
    if (bundle) {
      try {
        await deps.receiveMoveFile(
          takeId,
          "bundle",
          toWeb(fs.createReadStream(bundle))
        );
      } finally {
        await fsp.rm(bundle, { force: true });
      }
    }

    job.step = "conversation";
    await deps.receiveMoveFile(
      takeId,
      "transcript",
      toWeb(await deps.conversation(row))
    );
    if (run.cameBack) throw new Error("came back");

    job.step = "starting";
    deps.importMove(takeId);
    const done = await waitFor(deps, takeId, ["done"], IMPORT_MS, run);
    job.result = done.result;
    db.prepare(
      `UPDATE machine_backups SET state = 'taken', taken_at = ?
       WHERE machine_id = ? AND session_id = ? AND take_id = ?`
    ).run(Date.now(), row.machine_id, row.session_id, takeId);
    job.step = "done";
    await deps.dropConversation(row).catch(() => {});
    await deps.unpin(row, takeId).catch(() => {});
    // Online already: it pauses its own at once
    if (deps.online(row.machine_id)) deps.tellTaken(row.machine_id);
  } catch (error) {
    console.error("[take]", error);
    await deps.cancelMoveIn(takeId).catch(() => {});
    db.prepare(
      `UPDATE machine_backups SET state = 'current', take_id = NULL
       WHERE machine_id = ? AND session_id = ? AND take_id = ? AND state = 'taking'`
    ).run(row.machine_id, row.session_id, takeId);
    if (pinned) await deps.unpin(row, takeId).catch(() => {});
    job.step = "failed";
    job.error = run.cameBack
      ? TAKE_WHY_NOT.cameBack(job.machineName)
      : error instanceof Error
        ? error.message
        : "It didn't start here";
  }
}

/** Starts continuing a copy here; poll takeJob. Throws TakeRefused */
export async function startTake(
  machineId: string,
  sessionId: string,
  opts: { settingsOk: boolean },
  deps: TakeDeps = liveTakeDeps()
): Promise<TakeJob> {
  const db = deps.db;
  const machine = deps.machine(machineId);
  const row = machine ? backupRow(machineId, sessionId, db) : null;
  const why = whyNotTake({
    machine,
    online: deps.online(machineId),
    offlineMs: deps.offlineFor(machineId),
    row,
    hubSession: hubSession(db, sessionId),
    settingsOk: opts.settingsOk,
    offlineNeeded: offlineNeeded(),
  });
  if (why) throw new TakeRefused(why);
  const size = await deps.codeBytes(row!);
  if (size > BACKUP_LIMITS.machine || size > (await deps.freeBytes())) {
    throw new TakeRefused(TAKE_WHY_NOT.tooLarge);
  }
  // One wins: the row is claimed only while it is current
  const takeId = randomBytes(8).toString("hex");
  const { changes } = db
    .prepare(
      `UPDATE machine_backups SET state = 'taking', take_id = ?
       WHERE machine_id = ? AND session_id = ? AND state = 'current'`
    )
    .run(takeId, machineId, sessionId);
  if (changes !== 1) throw new TakeRefused(TAKE_WHY_NOT.taking);
  // It may have connected while the checks above ran: its connect found
  // nothing to call off, so this one gives way. From here on (still in
  // this tick, the job is registered below) a connect calls it off
  if (deps.online(machineId)) {
    db.prepare(
      `UPDATE machine_backups SET state = 'current', take_id = NULL
       WHERE machine_id = ? AND session_id = ? AND take_id = ?`
    ).run(machineId, sessionId, takeId);
    throw new TakeRefused(TAKE_WHY_NOT.online(machine!.name));
  }
  const claimed = backupRow(machineId, sessionId, db)!;
  const job: TakeJob = {
    id: randomBytes(8).toString("hex"),
    sessionId,
    machineId,
    machineName: machine!.name,
    hubName: deps.hubName(),
    copyAt: claimed.copied_at,
    step: "preparing",
  };
  const run: Running = {
    job,
    takeId,
    cameBack: false,
    cancel: () => deps.cancelMoveIn(takeId).then(() => {}),
  };
  takes().set(job.id, run);
  void runTake(run, claimed, deps);
  setTimeout(() => takes().delete(job.id), 60 * 60_000).unref?.();
  return job;
}

export const takeJob = (id: string): TakeJob | null =>
  takes().get(id)?.job ?? null;

/** The running take-over of a copy, if any */
export const takeOf = (machineId: string, sessionId: string): TakeJob | null =>
  [...takes().values()].find(
    (r) =>
      r.job.machineId === machineId &&
      r.job.sessionId === sessionId &&
      r.job.step !== "done" &&
      r.job.step !== "failed"
  )?.job ?? null;

/**
 * At this server's start: a take-over cut off by a restart stands when its
 * session runs here (moved_from.takeId), else the copy is current again
 */
export function recoverTakes(db: Database.Database = getDb()): number {
  const rows = db
    .prepare(`SELECT * FROM machine_backups WHERE state = 'taking'`)
    .all() as BackupRow[];
  for (const row of rows) {
    const session = hubSession(db, row.session_id);
    const from = parseMovedFrom(session?.moved_from);
    const stands =
      !!session && !session.settled_at && from?.takeId === row.take_id;
    if (stands) {
      db.prepare(
        `UPDATE machine_backups SET state = 'taken', taken_at = ?
         WHERE machine_id = ? AND session_id = ? AND state = 'taking'`
      ).run(Date.now(), row.machine_id, row.session_id);
    } else {
      db.prepare(
        `UPDATE machine_backups SET state = 'current', take_id = NULL
         WHERE machine_id = ? AND session_id = ? AND state = 'taking'`
      ).run(row.machine_id, row.session_id);
    }
  }
  return rows.length;
}
