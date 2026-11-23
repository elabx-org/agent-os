/**
 * A linked machine keeping copies of its Claude sessions on its hub
 * (lib/backup/receive.ts), and pausing the ones the hub continued from
 * those copies. Server only; started from lib/tickers.ts in machine mode.
 *
 * Copies run only while the user's switch on the hub is on and the hub's
 * "taken" list has come on this connection, so a session the hub took
 * over is paused before anything about it is sent. After each reply
 * (and every 5 minutes, for anything that changed) one session at a time
 * is copied: its code as a bundle of HEAD and a snapshot of uncommitted
 * work, and the conversation bytes the hub doesn't have yet. Nothing shows
 * on this machine; a failure leaves the session to be tried again.
 */

import { execFile } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { readClaudeState } from "../claude-state";
import { getDb, queries, type Project, type Session } from "../db";
import {
  hubUp,
  linkIdentity,
  takenReceived,
  uploadToHub,
  type UpAnswer,
  type UpInit,
} from "../link/machine";
import type { TakenResult, TakenSession } from "../link/protocol";
import { home } from "../link/secrets";
import { onEdge, wantWatch } from "../session-watch";
import { isLeaving, packBundle } from "../session-move";
import { parseMovedTo, type MovedTo } from "../session-move-types";
import { isRunning, tmuxNameOf } from "../session-launch";
import { SettleRefused, settleSession } from "../settle";
import { isSettled } from "../settle-types";
import { locateTranscript, sessionCwd } from "../transcript-locate";
import { git } from "../turns-git";
import {
  readWorkingTree,
  snapshotForMove,
  type MoveSnapshot,
} from "../worktree-move-git";
import { conversationRange, cutAtNewline, tailHash } from "./delta";
import { heldSessions } from "./hold";
import {
  BACKUP_SESSION_ID,
  type BackupBegin,
  type BackupManifest,
  type BackupPlan,
} from "./types";

const execFileAsync = promisify(execFile);

const SWEEP_MS = 5 * 60_000;
/** After a turn ends, so its last lines are written */
const SETTLE_MS = 5000;
/** At least this long between two copies of one session */
const AGAIN_MS = 20_000;
/** The hub is continuing it right now: ask again in a while */
const TAKING_MS = 30_000;
const CLAUDE_SID = /^[0-9a-f-]{36}$/;

/** What this machine last copied of a session */
export interface LocalCopy {
  claudeSessionId: string;
  bytes: number;
  head: string | null;
  snapshot: string | null;
  /** The snapshot's tree: a new snapshot of the same files is no change */
  snapshotTree?: string | null;
  /** What it looked like then (size, HEAD, changed files), to tell a change */
  sig: string;
  /** The hub was missing code: send all of it next time */
  fullNext?: boolean;
}

/** How the last try to copy a session went (lib/backup/hub-send.ts) */
export interface CopyStatus {
  /** When it was last known to be the same on both sides */
  at: number | null;
  tried: number;
  outcome: RunOutcome;
  error?: string;
  /** Lines of conversation in the copy */
  entries?: number;
  /** Changed files that aren't committed */
  unsaved?: number;
}

export interface BackupState {
  /** "<hub host>|<machine id>": another hub or a new link starts over */
  key: string;
  sessions: Record<string, LocalCopy>;
  status?: Record<string, CopyStatus>;
}

const shared = globalThis as typeof globalThis & {
  __agentosBackup?: {
    dirty: Set<string>;
    lastRun: Map<string, number>;
    working: boolean;
    started: boolean;
  };
};
const state = () =>
  (shared.__agentosBackup ??= {
    dirty: new Set(),
    lastRun: new Map(),
    working: false,
    started: false,
  });

// --- The local record ---

export const backupStatePath = () => path.join(home(), "backup-state.json");

/** The record for this hub and machine id; any other one is wiped */
export function readBackupState(key: string, file = backupStatePath()) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as BackupState;
    if (value?.key === key && value.sessions) return value;
  } catch {
    // Starts over
  }
  return { key, sessions: {} } as BackupState;
}

export function writeBackupState(
  value: BackupState,
  file = backupStatePath()
): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  } catch (error) {
    console.error("[backup] record:", error);
  }
}

// --- What may be copied ---

const getSession = (id: string) =>
  (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;

/** A Claude session that still runs here, and nobody else has */
export function eligible(session: Session): boolean {
  return (
    (session.agent_type || "claude") === "claude" &&
    !session.moved_to &&
    !(isSettled(session) && session.settled_reason === "moved") &&
    !isLeaving(session.id) &&
    !heldSessions().has(session.id) &&
    BACKUP_SESSION_ID.test(session.id) &&
    !unconfirmedTake(session.id)
  );
}

/**
 * Continued here from a copy, and the side it came from hasn't said it
 * paused its own yet: a copy sent now would be answered "we have it" and
 * pause this one instead
 */
function unconfirmedTake(sessionId: string): boolean {
  try {
    return !!getDb()
      .prepare(
        `SELECT 1 FROM machine_backups WHERE session_id = ? AND state = 'taken'
           AND machine_paused_at IS NULL AND orphan = 0`
      )
      .get(sessionId);
  } catch {
    return false;
  }
}

/** Read again: a move or a pause may have started while a copy was made */
function stillEligible(session: Session): boolean {
  return eligible(getSession(session.id) ?? session);
}

/** Copies are on: the user's switch, and the hub's "taken" list is in */
export const backupOn = () => hubUp().backup && takenReceived();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Not mid-turn: its hooks say the turn ended, or it isn't running */
async function idle(session: Session): Promise<boolean> {
  if (!(await isRunning(session).catch(() => false))) return true;
  const hooks = readClaudeState(session.id);
  return hooks.busy === false && !hooks.pendingPermission;
}

/** The answer's JSON, or null */
function json<T>(answer: UpAnswer): T | null {
  try {
    return JSON.parse(answer.body.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Calls to the hub's inbox; tests replace them */
export interface BackupDeps {
  upload(init: UpInit): Promise<UpAnswer>;
  idle(session: Session): Promise<boolean>;
  locate(session: Session): Promise<{ sessionId: string; file: string } | null>;
  pause(list: TakenSession[]): Promise<unknown>;
  tmpdir(): string;
}

export const liveDeps = (): BackupDeps => ({
  upload: uploadToHub,
  idle,
  locate: async (session) => {
    const found = await locateTranscript(session);
    return found?.file
      ? { sessionId: found.sessionId, file: found.file }
      : null;
  },
  pause: (list) => pauseTaken(list),
  tmpdir: os.tmpdir,
});

const inbox = (sessionId: string, what: string) =>
  `/api/link/inbox/backup/${sessionId}/${what}`;

const jsonInit = (method: string, p: string, body: unknown): UpInit => {
  const data = Buffer.from(JSON.stringify(body));
  return {
    method,
    path: p,
    headers: {
      "content-type": "application/json",
      "content-length": String(data.length),
    },
    body: data,
  };
};

/** What a session looks like now, to tell whether it changed */
export async function signature(session: Session, file: string | null) {
  const size = file ? ((await fsp.stat(file).catch(() => null))?.size ?? 0) : 0;
  const tree = await readWorkingTree(sessionCwd(session)).catch(() => null);
  const files: string[] = [];
  if (tree) {
    for (const f of tree.uncommitted.slice(0, 500)) {
      const st = await fsp
        .stat(path.join(tree.toplevel, f.path))
        .catch(() => null);
      files.push(`${f.path}:${st?.size ?? -1}:${st?.mtimeMs ?? 0}`);
    }
  }
  return JSON.stringify([size, tree?.head ?? null, files]);
}

export type RunOutcome =
  | "copied"
  | "unchanged"
  | "dropped"
  | "taken"
  | "taking"
  | "off"
  | "failed";

/**
 * Copies one session. "dropped": a turn started meanwhile (the next turn's
 * end tries again). Throws only for this machine's own failures
 */
export async function backupOne(
  session: Session,
  record: BackupState,
  deps: BackupDeps = liveDeps()
): Promise<RunOutcome> {
  const id = session.id;
  // 1. The conversation the pane shows, kept on the row
  const located = await deps.locate(session);
  if (!located || !CLAUDE_SID.test(located.sessionId)) return "unchanged";
  if (located.sessionId !== session.claude_session_id) {
    queries.updateSessionClaudeId(getDb()).run(located.sessionId, id);
  }
  const claudeSessionId = located.sessionId;
  const file = located.file;
  // 2. Its whole lines
  const size = (await fsp.stat(file)).size;
  const length = await cutAtNewline(file, size);
  const before = await tailHash(file, length);
  const sig = await signature(session, file);
  const mine = record.sessions[id];

  // 3. The code: HEAD, and uncommitted work as a hidden commit
  const cwd = sessionCwd(session);
  const tree = await readWorkingTree(cwd).catch(() => null);
  let repo: BackupManifest["repo"] = null;
  let first: string | null = null;
  let snapshot: MoveSnapshot | null = null;
  if (tree?.head) {
    const top = tree.toplevel;
    snapshot =
      tree.uncommitted.length > 0
        ? await snapshotForMove(cwd, id, {
            ref: `refs/agent-os/${id}/backup`,
            label: `backup-${id}`,
          })
        : null;
    if (!snapshot) {
      await git(["update-ref", "-d", `refs/agent-os/${id}/backup`], {
        cwd: top,
      }).catch(() => {});
    }
    await git(["update-ref", `refs/agent-os/${id}/backup-head`, tree.head], {
      cwd: top,
    });
    const roots = await git(["rev-list", "--max-parents=0", tree.head], {
      cwd: top,
      timeoutMs: 120_000,
    });
    first = roots.trim().split("\n").pop() || null;
    const remote = await git(["remote", "get-url", "origin"], { cwd: top })
      .then((r) => r.trim() || null)
      .catch(() => null);
    repo = {
      name: path.basename(top),
      remote,
      head: tree.head,
      branch: tree.branch,
      subdir: path.relative(fs.realpathSync(top), fs.realpathSync(cwd)),
    };
  }
  if (
    mine &&
    mine.claudeSessionId === claudeSessionId &&
    mine.bytes === length &&
    mine.head === (repo?.head ?? null) &&
    (mine.snapshotTree ?? null) === (snapshot?.tree ?? null) &&
    !mine.fullNext
  ) {
    mine.sig = sig;
    return "unchanged";
  }

  // 4. Still the same: no turn started while this was read
  const now = await fsp.stat(file).catch(() => null);
  if (
    !(await deps.idle(getSession(id) ?? session)) ||
    !now ||
    now.size < length ||
    (await tailHash(file, length)) !== before
  ) {
    return "dropped";
  }

  // 5. Begin, unless it started leaving meanwhile (a move out of here)
  if (!stillEligible(session)) return "dropped";
  const begin: BackupBegin = {
    v: 1,
    claudeSessionId,
    repo:
      repo && first ? { name: repo.name, remote: repo.remote, first } : null,
    transcriptBytes: length,
  };
  const started = await deps.upload(
    jsonInit("POST", inbox(id, "begin"), begin)
  );
  if (started.status !== 200) {
    const refusal = json<{ code?: string; taken?: TakenSession }>(started);
    if (refusal?.code === "taken" && refusal.taken) {
      await deps.pause([refusal.taken]);
      return "taken";
    }
    if (refusal?.code === "taking") return "taking";
    if (refusal?.code === "backup_off") return "off";
    return "failed";
  }
  const plan = json<BackupPlan>(started);
  if (!plan || !/^[0-9a-f]{16}$/.test(plan.backupId)) return "failed";
  const query = `backup=${plan.backupId}`;

  // 6. Code the hub's copy doesn't have
  if (
    repo &&
    tree &&
    (mine?.fullNext ||
      plan.head !== repo.head ||
      plan.snapshot !== (snapshot?.commit ?? null))
  ) {
    const bundle = path.join(
      deps.tmpdir(),
      `agentos-backup-${id}-${plan.backupId}.bundle`
    );
    try {
      const made = await packBundle(
        tree.toplevel,
        [
          `refs/agent-os/${id}/backup-head`,
          ...(snapshot ? [`refs/agent-os/${id}/backup`] : []),
        ],
        mine?.fullNext ? [] : plan.have,
        bundle
      );
      if (made) {
        const bytes = (await fsp.stat(made)).size;
        const sent = await deps.upload({
          method: "PUT",
          path: `${inbox(id, "bundle")}?${query}`,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(bytes),
          },
          body: fs.createReadStream(made),
        });
        if (sent.status !== 200) return "failed";
      }
    } finally {
      await fsp.rm(bundle, { force: true });
    }
  }

  // 7. The conversation bytes it doesn't have
  const range = conversationRange({
    length,
    offset: plan.offset,
    hubTail: plan.tail,
    localTail: plan.offset <= length ? await tailHash(file, plan.offset) : null,
  });
  if (range.reset || range.from < length) {
    const sent = await deps.upload({
      method: "PUT",
      path: `${inbox(id, "file")}?${query}&offset=${range.from}&reset=${range.reset ? 1 : 0}`,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(length - range.from),
      },
      body:
        length > range.from
          ? fs.createReadStream(file, { start: range.from, end: length - 1 })
          : Buffer.alloc(0),
    });
    if (sent.status !== 200) return "failed";
  }

  // 8. Commit; a copy of a session that has left would outlive the move
  if (!stillEligible(session)) return "dropped";
  const fresh = getSession(id) ?? session;
  const project = fresh.project_id
    ? (queries.getProject(getDb()).get(fresh.project_id) as Project | undefined)
    : undefined;
  const manifest: BackupManifest = {
    v: 1,
    sessionId: id,
    name: fresh.name,
    claudeSessionId,
    model: fresh.model,
    modelPinned: !!fresh.model_pinned,
    effort: fresh.effort,
    permissionMode: fresh.permission_mode,
    autoApprove: !!fresh.auto_approve,
    subagentModel: fresh.subagent_model,
    subagentOwnFirst: !!fresh.subagent_own_first,
    systemPrompt: fresh.system_prompt,
    repo,
    snapshot,
    projectName: project && !project.is_uncategorized ? project.name : null,
    lastActiveAt: Date.parse(`${fresh.updated_at}Z`) || Date.now(),
    transcriptBytes: length,
  };
  const committed = await deps.upload(
    jsonInit("POST", inbox(id, "commit"), { backupId: plan.backupId, manifest })
  );
  if (committed.status !== 200) {
    const refusal = json<{ code?: string }>(committed);
    if (refusal?.code === "missing_code") {
      record.sessions[id] = { ...(mine ?? emptyCopy()), fullNext: true };
    }
    return refusal?.code === "taking" ? "taking" : "failed";
  }
  record.sessions[id] = {
    claudeSessionId,
    bytes: length,
    head: repo?.head ?? null,
    snapshot: snapshot?.commit ?? null,
    snapshotTree: snapshot?.tree ?? null,
    sig,
  };
  return "copied";
}

const emptyCopy = (): LocalCopy => ({
  claudeSessionId: "",
  bytes: -1,
  head: null,
  snapshot: null,
  sig: "",
});

const recordKey = () => {
  const who = linkIdentity();
  return who ? `${who.hubHost}|${who.machineId}` : null;
};

/** Copies what is marked, one session at a time */
async function work(): Promise<void> {
  const s = state();
  if (s.working) return;
  s.working = true;
  try {
    while (s.dirty.size > 0 && backupOn()) {
      const key = recordKey();
      if (!key) return;
      const record = readBackupState(key);
      const now = Date.now();
      const id = [...s.dirty].find(
        (d) => now - (s.lastRun.get(d) ?? 0) >= AGAIN_MS
      );
      if (!id) {
        setTimeout(() => void work(), AGAIN_MS).unref();
        return;
      }
      s.dirty.delete(id);
      s.lastRun.set(id, now);
      const session = getSession(id);
      if (!session || !eligible(session)) continue;
      let outcome: RunOutcome = "failed";
      try {
        outcome = await backupOne(session, record);
      } catch (error) {
        console.error("[backup] copy:", error);
      }
      writeBackupState(record);
      if (outcome === "taking") {
        setTimeout(() => mark(id), TAKING_MS).unref();
      } else if (outcome === "failed") {
        // Tried again at the next sweep
      } else if (outcome === "off") {
        s.dirty.clear();
      }
    }
  } finally {
    s.working = false;
  }
}

/** Marks a session to be copied soon */
export function mark(sessionId: string): void {
  state().dirty.add(sessionId);
  void work();
}

/**
 * Every 5 minutes, and right after each "taken" list: the hub drops the
 * copies of sessions that are gone, and anything that changed is copied
 */
export async function sweep(): Promise<void> {
  if (!backupOn()) return;
  const key = recordKey();
  if (!key) return;
  const sessions = (queries.getAllSessions(getDb()).all() as Session[]).filter(
    eligible
  );
  try {
    await uploadToHub(
      jsonInit("POST", "/api/link/inbox/backup/sessions", {
        ids: sessions.map((s) => s.id).slice(0, 2000),
      })
    );
  } catch (error) {
    console.error("[backup] sessions:", error);
    return;
  }
  const record = readBackupState(key);
  for (const session of sessions) {
    const located = await locateTranscript(session).catch(() => null);
    if (!located?.file) continue;
    const sig = await signature(session, located.file).catch(() => "");
    if (record.sessions[session.id]?.sig !== sig) state().dirty.add(session.id);
  }
  void work();
}

/** lib/tickers.ts, in machine mode */
export function startMachineBackup(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  wantWatch(() => backupOn());
  onEdge((edge) => {
    if (
      edge.from !== "running" ||
      edge.to === "running" ||
      edge.to === "gone"
    ) {
      return;
    }
    if (!backupOn()) return;
    const hooks = readClaudeState(edge.sessionId);
    if (hooks.busy !== false || hooks.pendingPermission) return;
    setTimeout(() => mark(edge.sessionId), SETTLE_MS).unref();
  });
  setInterval(() => {
    sweep().catch((error) => console.error("[backup] sweep:", error));
  }, SWEEP_MS).unref();
}

// --- Pausing what the hub continued ---

export interface PauseDeps {
  getSession(id: string): Session | null;
  isRunning(session: Session): Promise<boolean>;
  kill(session: Session): Promise<void>;
  settle(session: Session): Promise<void>;
  /** Pins uncommitted work as a commit; null when clean */
  snapshot(session: Session): Promise<MoveSnapshot | null>;
  /** HEAD and branch now; null outside git */
  head(
    session: Session
  ): Promise<{ head: string; branch: string | null } | null>;
  /** The conversation file and its Claude id */
  conversation(
    session: Session
  ): Promise<{ sessionId: string; file: string | null } | null>;
  keep(file: string, dir: string): Promise<void>;
  write(sessionId: string, movedTo: MovedTo): void;
  now(): number;
}

const livePause = (): PauseDeps => ({
  getSession,
  isRunning,
  kill: async (session) => {
    await execFileAsync("tmux", [
      "kill-session",
      "-t",
      `=${tmuxNameOf(session)}`,
    ]);
  },
  settle: async (session) => {
    try {
      await settleSession(session, { reason: "moved", force: true });
    } catch (error) {
      // Already settled, or handed off: it is stopped either way
      if (!(error instanceof SettleRefused)) throw error;
    }
    getDb()
      .prepare(
        `UPDATE sessions SET settled_at = COALESCE(settled_at, ?),
           settled_reason = 'moved', updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(Date.now(), session.id);
  },
  snapshot: async (session) => {
    const cwd = sessionCwd(session);
    const tree = await readWorkingTree(cwd);
    if (!tree?.head || tree.uncommitted.length === 0) return null;
    return snapshotForMove(cwd, session.id, {
      ref: `refs/agent-os/${session.id}/backup`,
      label: `backup-${session.id}`,
    });
  },
  head: async (session) => {
    const tree = await readWorkingTree(sessionCwd(session)).catch(() => null);
    return tree?.head ? { head: tree.head, branch: tree.branch } : null;
  },
  conversation: async (session) => {
    const found = await locateTranscript(session);
    return found ? { sessionId: found.sessionId, file: found.file } : null;
  },
  keep: async (file, dir) => {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await fsp.copyFile(file, path.join(dir, path.basename(file)));
  },
  write: (sessionId, movedTo) => {
    getDb()
      .prepare(
        `UPDATE sessions SET moved_to = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(JSON.stringify(movedTo), sessionId);
  },
  now: Date.now,
});

const TAKE_ID = /^[0-9a-f]{16}$/;

/** Kills its tmux and checks it is gone, a few times */
async function stopped(session: Session, deps: PauseDeps): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await deps.isRunning(session).catch(() => true))) return true;
    await deps.kill(session).catch(() => {});
    await sleep(attempt === 0 ? 100 : 500);
  }
  return !(await deps.isRunning(session).catch(() => true));
}

/**
 * The hub continued these sessions from their copies: each is stopped
 * here first (whatever its row says), then pinned, settled and marked as
 * continued there. Nothing is deleted. Called from the link client when
 * the hub's "taken" list arrives
 */
export async function pauseTaken(
  list: TakenSession[],
  deps: PauseDeps = livePause(),
  /** Who carries them on: the hub, or on the hub the machine's id */
  peer: { id: string } = { id: "hub" }
): Promise<TakenResult[]> {
  const valid = list.filter(
    (t) =>
      t &&
      typeof t.sessionId === "string" &&
      BACKUP_SESSION_ID.test(t.sessionId) &&
      typeof t.takeId === "string" &&
      TAKE_ID.test(t.takeId)
  );
  // 1. Held at once: nothing copies or starts them from here on
  for (const t of valid) heldSessions().add(t.sessionId);
  const results: TakenResult[] = [];
  for (const t of valid) {
    try {
      results.push(await pauseOne(t, deps, peer));
    } catch (error) {
      console.error("[backup] pausing a continued session:", error);
      results.push({
        sessionId: t.sessionId,
        takeId: t.takeId,
        state: "failed",
      });
    }
  }
  // On the hub a paused session is settled as moved: that alone keeps it
  // from starting or being copied, and it can come back by a move
  if (peer.id !== "hub") {
    for (const r of results) {
      if (r.state !== "failed") heldSessions().delete(r.sessionId);
    }
  }
  // Right after each list: what changed while offline is copied
  if (peer.id === "hub") {
    setTimeout(() => void sweep().catch(() => {}), 1000).unref();
  }
  return results;
}

async function pauseOne(
  t: TakenSession,
  deps: PauseDeps,
  peer: { id: string }
): Promise<TakenResult> {
  const base = { sessionId: t.sessionId, takeId: t.takeId };
  // 2. Not here, or it went on to another machine since
  const session = deps.getSession(t.sessionId);
  const went = session ? parseMovedTo(session.moved_to) : null;
  if (!session || (went && went.machine !== peer.id)) {
    return { ...base, state: "gone" };
  }
  // Which conversation it is on, asked of the live pane while there is one
  // (a /clear offline starts a new one the row doesn't know); briefly, so
  // the stop below isn't held up
  const live = await Promise.race([
    deps.conversation(session).catch(() => null),
    sleep(3000).then(() => null),
  ]);
  // 3. Stopped, whatever the row says, and seen to be stopped
  if (!(await stopped(session, deps))) return { ...base, state: "failed" };
  const folder = sessionCwd(session).slice(0, 300);
  if (went?.takeover?.takeId === t.takeId) {
    return { ...base, state: "already", ahead: went.takeover.ahead, folder };
  }
  if (went && !went.takeover) {
    // It already went to the hub the ordinary way
    return { ...base, state: "already", folder };
  }
  // 4. What it did offline, pinned as a commit
  const snapshot = await deps.snapshot(session).catch(() => null);
  // 5. Settled as moved
  await deps.settle(session);
  // 6. More here than in the copy?
  const conversation =
    live ?? (await deps.conversation(session).catch(() => null));
  const size = conversation?.file
    ? ((await fsp.stat(conversation.file).catch(() => null))?.size ?? 0)
    : 0;
  const now = await deps.head(session).catch(() => null);
  const ahead = {
    conversation:
      (!!conversation && conversation.sessionId !== t.claudeSessionId) ||
      size > t.transcriptBytes,
    code:
      (now?.head ?? null) !== t.head ||
      (snapshot?.tree ?? null) !== (t.tree ?? null),
  };
  // 7. The newer conversation kept aside as well
  if (ahead.conversation && conversation?.file) {
    await deps
      .keep(
        conversation.file,
        path.join(home(), "kept", `${t.sessionId}-${t.takeId}`)
      )
      .catch((error) => console.error("[backup] keeping:", error));
  }
  // 8. Marked as continued on the hub
  deps.write(t.sessionId, {
    machine: peer.id,
    name: typeof t.hubName === "string" ? t.hubName.slice(0, 80) : "the server",
    at: deps.now(),
    head: now?.head ?? "",
    branch: now?.branch ?? null,
    snapshot: null,
    takeover: {
      takeId: t.takeId,
      copyAt: Number.isFinite(t.copyAt) ? t.copyAt : 0,
      ahead,
    },
  });
  return { ...base, state: "paused", ahead, folder };
}
