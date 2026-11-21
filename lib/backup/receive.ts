/**
 * The hub taking in a machine's copies (app/api/link/inbox/backup/*). The
 * machine is always the one the link's tunnel vouched for
 * (requireLinkMachine), never a name in the request. Server only.
 *
 * One upload: begin (a new backup id; any older upload is dead), then the
 * code as a git bundle and the new conversation bytes, then commit. Only
 * commit changes the copy, and only in this order: the conversation, the
 * row, the refs. A crash before it leaves the copy as it was; the next
 * begin cuts off anything a half-done commit appended.
 */

import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type Database from "better-sqlite3";
import { getDb, queries, type Session } from "../db";
import type { MachineRow } from "../link/store";
import { UP_ERRORS } from "../link/up";
import { isSafeModelName } from "../model-name";
import { validManifest } from "../session-move";
import { parseMovedTo } from "../session-move-types";
import { git } from "../turns-git";
import {
  BACKUP_GIT_MS,
  BACKUP_LIMITS,
  backupRow,
  backupRows,
  conversationFile,
  deleteCopies,
  departed,
  ensureBareRepo,
  ensureDir,
  folderBytes,
  freeBytes,
  incomingDir,
  machineDir,
  openForWrite,
  repoDir,
  repoKeyOf,
  sessionDir,
  type BackupRow,
} from "./store";
import {
  BACKUP_ID,
  BACKUP_SESSION_ID,
  type BackupBegin,
  type BackupManifest,
  type BackupPlan,
  type BackupRefusal,
} from "./types";
import { takenFromRow, takenFromSession } from "./taken";
import { EMPTY_TAIL, tailHash } from "./delta";

const SHA = /^[0-9a-f]{40}$/;
const CLAUDE_SID = /^[0-9a-f-]{36}$/;
const HAVE_MAX = 400;

export const BACKUP_ERRORS: Record<BackupRefusal | "bad_request", string> = {
  backup_off: UP_ERRORS.backup_off,
  taking: "This session is being continued on the server right now.",
  taken: "This session continued on the server.",
  full: "Copies from this machine have reached their limit on the server.",
  too_large: UP_ERRORS.too_large,
  mismatch: "The server's copy doesn't match. Start the copy again.",
  missing_code: "The server's copy is missing some of the code.",
  stale: "A newer copy of this session was started.",
  bad_request: UP_ERRORS.bad_request,
};

const STATUS: Record<BackupRefusal | "bad_request", number> = {
  backup_off: 403,
  taking: 409,
  taken: 409,
  full: 507,
  too_large: 413,
  mismatch: 409,
  missing_code: 409,
  stale: 409,
  bad_request: 400,
};

export class BackupError extends Error {
  readonly status: number;
  constructor(
    readonly code: BackupRefusal | "bad_request",
    readonly extra: Record<string, unknown> = {}
  ) {
    super(BACKUP_ERRORS[code]);
    this.status = STATUS[code];
  }
  body() {
    return { error: this.message, code: this.code, ...this.extra };
  }
}

const clip = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max)
    : "";

const getSession = (id: string, db: Database.Database) =>
  (queries.getSession(db).get(id) as Session | undefined) ?? null;

/** Passes bytes on until there are more than `max`; then fails with `code` */
function capped(max: number, code: BackupRefusal): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      done(seen > max ? new BackupError(code) : null, chunk);
    },
  });
}

const fromWeb = (body: ReadableStream<Uint8Array>) =>
  Readable.fromWeb(body as import("stream/web").ReadableStream);

/** What this machine may still store, refusing when the disk is low */
async function roomLeft(machineId: string): Promise<number> {
  if ((await freeBytes()) < BACKUP_LIMITS.minFree) {
    throw new BackupError("full");
  }
  const left =
    BACKUP_LIMITS.machine - (await folderBytes(machineDir(machineId)));
  if (left <= 0) throw new BackupError("full");
  return left;
}

function checkSessionId(sessionId: string): void {
  if (!BACKUP_SESSION_ID.test(sessionId)) throw new BackupError("bad_request");
}

/** The hub's own session of that id, unless it moved back to the caller */
function hubHolds(
  sessionId: string,
  machineId: string,
  db: Database.Database
): Session | null {
  const session = getSession(sessionId, db);
  if (!session) return null;
  const went = parseMovedTo(session.moved_to);
  if (session.settled_at && went?.machine === machineId) return null;
  return session;
}

/** Commits in the copied repository, for the bundle to leave out */
async function haveOf(repo: string): Promise<string[]> {
  if (!fs.existsSync(repo)) return [];
  const out = await git(
    [
      "for-each-ref",
      "--format=%(objectname) %(objecttype)",
      `--count=${HAVE_MAX}`,
      "refs/agent-os/",
    ],
    { cwd: repo }
  ).catch(() => "");
  const have: string[] = [];
  for (const line of out.split("\n")) {
    const [sha, type] = line.split(" ");
    if (type === "commit" && SHA.test(sha) && !have.includes(sha)) {
      have.push(sha);
    }
  }
  return have;
}

async function dropIncomingRefs(repo: string, sessionId: string) {
  if (!fs.existsSync(repo)) return;
  const refs = await git(
    ["for-each-ref", "--format=%(refname)", `refs/incoming/${sessionId}/`],
    { cwd: repo }
  ).catch(() => "");
  for (const ref of refs.split("\n").filter(Boolean)) {
    await git(["update-ref", "-d", ref], { cwd: repo }).catch(() => {});
  }
}

function validBegin(value: unknown): value is BackupBegin {
  const b = value as BackupBegin;
  return (
    !!b &&
    b.v === 1 &&
    typeof b.claudeSessionId === "string" &&
    CLAUDE_SID.test(b.claudeSessionId) &&
    Number.isSafeInteger(b.transcriptBytes) &&
    b.transcriptBytes >= 0 &&
    (b.repo === null ||
      (!!b.repo &&
        typeof b.repo.name === "string" &&
        b.repo.name.length <= 300 &&
        (b.repo.remote === null ||
          (typeof b.repo.remote === "string" &&
            b.repo.remote.length <= 2048)) &&
        typeof b.repo.first === "string" &&
        SHA.test(b.repo.first)))
  );
}

/** The upload under way: its begin, or stale */
async function upload(
  machineId: string,
  sessionId: string,
  backupId: unknown
): Promise<{ dir: string; begin: BackupBegin }> {
  checkSessionId(sessionId);
  if (typeof backupId !== "string" || !BACKUP_ID.test(backupId)) {
    throw new BackupError("stale");
  }
  const dir = incomingDir(machineId, sessionId, backupId);
  let begin: BackupBegin;
  try {
    begin = JSON.parse(
      await fsp.readFile(path.join(dir, "begin.json"), "utf8")
    );
  } catch {
    throw new BackupError("stale");
  }
  return { dir, begin };
}

/** Whether this upload starts the conversation over (new id, or reset) */
const startsOver = (row: BackupRow | null, begin: BackupBegin, dir: string) =>
  !row ||
  row.claude_session_id !== begin.claudeSessionId ||
  fs.existsSync(path.join(dir, "reset"));

// --- The routes ---

/** POST …/backup/sessions {ids}: the copies of sessions it no longer has go */
export async function syncSessions(
  machine: MachineRow,
  body: unknown,
  db: Database.Database = getDb()
): Promise<{ removed: number }> {
  const ids = (body as { ids?: unknown })?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > BACKUP_LIMITS.sessions ||
    !ids.every((id) => typeof id === "string" && BACKUP_SESSION_ID.test(id))
  ) {
    throw new BackupError("bad_request");
  }
  const keep = new Set(ids as string[]);
  const gone = backupRows(machine.id, db).filter(
    (r) => r.state === "current" && !keep.has(r.session_id)
  );
  return { removed: await deleteCopies(gone, db) };
}

/** POST …/backup/[session]/begin */
export async function beginBackup(
  machine: MachineRow,
  sessionId: string,
  body: unknown,
  db: Database.Database = getDb()
): Promise<BackupPlan> {
  checkSessionId(sessionId);
  if (!validBegin(body)) throw new BackupError("bad_request");
  if (body.transcriptBytes > BACKUP_LIMITS.conversation) {
    throw new BackupError("too_large");
  }
  let row = backupRow(machine.id, sessionId, db);
  // This server has the session itself: the machine's copy must pause,
  // whether or not it was ever marked
  const held = hubHolds(sessionId, machine.id, db);
  if (held) {
    throw new BackupError("taken", { taken: takenFromSession(held, row) });
  }
  if (row?.state === "taking") throw new BackupError("taking");
  // It moved away from that machine: whatever is still copying is old
  if (departed(machine.id, sessionId, db)) throw new BackupError("stale");
  if (row?.state === "taken") {
    const session = getSession(sessionId, db);
    if (!session) {
      throw new BackupError("taken", { taken: takenFromRow(row) });
    }
    // It went back to that machine: its copies start again, from nothing.
    // The take-over dropped this copy's conversation, and the machine's
    // code may have moved on: no claude id means the next copy is whole
    db.prepare(
      `UPDATE machine_backups SET state = 'current', take_id = NULL,
         taken_at = NULL, machine_paused_at = NULL, ahead = NULL,
         claude_session_id = '', file_bytes = 0, head = NULL,
         snapshot_commit = NULL, snapshot_tree = NULL
       WHERE machine_id = ? AND session_id = ? AND state = 'taken'`
    ).run(machine.id, sessionId);
    row = backupRow(machine.id, sessionId, db);
  }
  if (!row) {
    const { n } = db
      .prepare(
        `SELECT COUNT(*) AS n FROM machine_backups WHERE machine_id = ? AND orphan = 0`
      )
      .get(machine.id) as { n: number };
    if (n >= BACKUP_LIMITS.sessions) throw new BackupError("full");
  }
  await roomLeft(machine.id);

  const key = body.repo ? repoKeyOf(body.repo) : null;
  const repo = key ? repoDir(machine.id, key) : null;
  // Whatever an earlier upload left is dropped: its id is dead now
  const dir = sessionDir(machine.id, sessionId);
  await fsp.rm(path.join(dir, "incoming"), { recursive: true, force: true });
  if (repo) await dropIncomingRefs(repo, sessionId);
  if (row?.repo_key && row.repo_key !== key) {
    await dropIncomingRefs(repoDir(machine.id, row.repo_key), sessionId);
  }
  // A commit that crashed half-way appended past what the row says
  if (row) {
    const live = conversationFile(machine.id, sessionId, row.file_gen);
    const st = await fsp.lstat(live).catch(() => null);
    if (st?.isFile() && st.size > row.file_bytes) {
      await fsp.truncate(live, row.file_bytes);
    }
  }
  const backupId = randomBytes(8).toString("hex");
  const incoming = incomingDir(machine.id, sessionId, backupId);
  await ensureDir(incoming);
  const handle = await openForWrite(
    path.join(incoming, "begin.json"),
    "create"
  );
  try {
    await handle.writeFile(JSON.stringify(body));
  } finally {
    await handle.close();
  }

  const sameConversation =
    !!row && row.claude_session_id === body.claudeSessionId;
  const offset = sameConversation ? row!.file_bytes : 0;
  const live = row
    ? conversationFile(machine.id, sessionId, row.file_gen)
    : null;
  const sameRepo = !!row && row.repo_key === key;
  return {
    backupId,
    offset,
    tail: offset > 0 && live ? await tailHash(live, offset) : EMPTY_TAIL,
    head: sameRepo ? row!.head : null,
    snapshot: sameRepo ? row!.snapshot_commit : null,
    have: repo ? await haveOf(repo) : [],
  };
}

/** PUT …/backup/[session]/bundle?backup=: the code, checked object by object */
export async function receiveBundle(
  machine: MachineRow,
  sessionId: string,
  backupId: unknown,
  body: ReadableStream<Uint8Array> | null,
  db: Database.Database = getDb()
): Promise<{ bytes: number }> {
  const { dir, begin } = await upload(machine.id, sessionId, backupId);
  if (!begin.repo || !body) throw new BackupError("bad_request");
  if (backupRow(machine.id, sessionId, db)?.state === "taking") {
    throw new BackupError("taking");
  }
  const left = await roomLeft(machine.id);
  const file = path.join(dir, "bundle");
  const handle = await openForWrite(file, "create");
  try {
    await pipeline(
      fromWeb(body),
      capped(
        Math.min(BACKUP_LIMITS.bundle, left),
        left < BACKUP_LIMITS.bundle ? "full" : "too_large"
      ),
      handle.createWriteStream()
    );
  } finally {
    await handle.close().catch(() => {});
  }
  const bytes = (await fsp.stat(file)).size;
  const repo = repoDir(machine.id, repoKeyOf(begin.repo));
  try {
    await ensureBareRepo(repo);
    // `git fetch <bundle>` doesn't check objects on every git version, so
    // its pack goes through index-pack --strict (fsck of each object)
    const { refs, packAt } = await bundleHeader(file);
    const id = backupId as string;
    const wanted = [
      [`refs/agent-os/${sessionId}/backup-head`, "head"],
      [`refs/agent-os/${sessionId}/backup`, "snap"],
    ]
      .map(([name, as]) => ({ sha: refs.get(name), as }))
      .filter((r): r is { sha: string; as: string } => !!r.sha);
    if (wanted.length === 0) throw new BackupError("bad_request");
    await indexPack(repo, file, packAt);
    for (const { sha } of wanted) {
      // Every object it needs is here: nothing dangles from a copy
      await git(
        ["rev-list", "--objects", "--missing=error", sha, "--not", "--all"],
        { cwd: repo, timeoutMs: BACKUP_GIT_MS }
      );
      const type = (await git(["cat-file", "-t", sha], { cwd: repo })).trim();
      if (type !== "commit") throw new BackupError("bad_request");
    }
    for (const { sha, as } of wanted) {
      await git(["update-ref", `refs/incoming/${sessionId}/${id}/${as}`, sha], {
        cwd: repo,
      });
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    console.error("[backup] bundle:", error);
    throw new BackupError("bad_request");
  } finally {
    await fsp.rm(file, { force: true });
  }
  return { bytes };
}

/** A bundle's refs, and where its pack starts (git's bundle v2/v3 format) */
async function bundleHeader(
  file: string
): Promise<{ refs: Map<string, string>; packAt: number }> {
  const handle = await fsp.open(file, "r");
  try {
    const head = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const text = head.subarray(0, bytesRead).toString("latin1");
    const end = text.indexOf("\n\n");
    if (end < 0 || !/^# v[23] git bundle\n/.test(text)) {
      throw new BackupError("bad_request");
    }
    const refs = new Map<string, string>();
    for (const line of text.slice(0, end).split("\n").slice(1)) {
      if (line.startsWith("@") || line.startsWith("-")) continue;
      const [sha, name] = line.split(" ");
      if (SHA.test(sha) && name) refs.set(name, sha);
    }
    return { refs, packAt: end + 2 };
  } finally {
    await handle.close();
  }
}

/** The bundle's pack into `repo`, every object checked */
function indexPack(repo: string, file: string, start: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["index-pack", "--strict", "--fix-thin", "--stdin"],
      {
        cwd: repo,
        stdio: ["pipe", "ignore", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      }
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), BACKUP_GIT_MS);
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 4000) err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`index-pack: ${err.trim()}`));
    });
    fs.createReadStream(file, { start })
      .on("error", reject)
      .pipe(child.stdin)
      .on("error", () => {});
  });
}

/**
 * PUT …/backup/[session]/file?backup=&offset=&reset=: conversation bytes.
 * `offset` is the machine's word of where they start; it must be where the
 * copy ends (0 when it starts over). Nothing is written at any other place
 */
export async function receiveFile(
  machine: MachineRow,
  sessionId: string,
  query: { backup: unknown; offset: unknown; reset: unknown },
  body: ReadableStream<Uint8Array> | null,
  db: Database.Database = getDb()
): Promise<{ bytes: number }> {
  const { dir, begin } = await upload(machine.id, sessionId, query.backup);
  const offset = Number(query.offset);
  if (
    !body ||
    typeof query.offset !== "string" ||
    !/^\d{1,13}$/.test(query.offset) ||
    (query.reset !== "0" && query.reset !== "1")
  ) {
    throw new BackupError("bad_request");
  }
  const row = backupRow(machine.id, sessionId, db);
  if (row?.state === "taking") throw new BackupError("taking");
  const part = path.join(dir, "conversation.part");
  const marker = path.join(dir, "reset");
  const partBytes = (await fsp.lstat(part).catch(() => null))?.size ?? 0;
  if (query.reset === "1" && !fs.existsSync(marker)) {
    // Starting over after some bytes went the other way is a mix-up
    if (partBytes > 0) throw new BackupError("mismatch");
    const handle = await openForWrite(marker, "create");
    await handle.close();
  }
  const base = startsOver(row, begin, dir) ? 0 : row!.file_bytes;
  if (offset !== base + partBytes) throw new BackupError("mismatch");
  const left = await roomLeft(machine.id);
  const conversationLeft = BACKUP_LIMITS.conversation - offset;
  const handle = await openForWrite(part, "append");
  try {
    await pipeline(
      fromWeb(body),
      capped(
        Math.min(left, conversationLeft),
        left < conversationLeft ? "full" : "too_large"
      ),
      handle.createWriteStream()
    );
  } finally {
    await handle.close().catch(() => {});
  }
  return { bytes: (await fsp.stat(part)).size - partBytes };
}

/** The tree's file names that make Claude run commands by itself */
export function settingsNames(names: string[]): boolean {
  return names.some(
    (name) =>
      name === ".mcp.json" ||
      name === ".claude/settings.json" ||
      name === ".claude/settings.local.json" ||
      name.startsWith(".claude/hooks/") ||
      // The same anywhere below the top: a session may work in a subfolder
      /(^|\/)\.mcp\.json$/.test(name) ||
      /(^|\/)\.claude\/(settings(\.local)?\.json|hooks\/)/.test(name)
  );
}

/** Names a symlink may not carry: through one, Claude would read settings the names above miss */
const SETTINGS_LINK =
  /(^|\/)(\.claude|\.mcp\.json|hooks|settings(\.local)?\.json)$/;

/**
 * The same over `ls-tree -r -z` lines ("<mode> <type> <sha>\t<path>"). A
 * symlink named .claude (or like a settings file) counts as settings, since
 * its target's files are never listed under that name
 */
export function settingsEntries(lines: string[]): boolean {
  const names: string[] = [];
  for (const line of lines) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const name = line.slice(tab + 1);
    if (line.startsWith("120000 ") && SETTINGS_LINK.test(name)) return true;
    names.push(name);
  }
  return settingsNames(names);
}

/** Whether a commit's tree holds Claude settings that run commands */
export async function hasSettings(repo: string, commits: string[]) {
  for (const commit of commits) {
    const lines = await git(["ls-tree", "-r", "-z", commit], {
      cwd: repo,
      timeoutMs: BACKUP_GIT_MS,
    });
    if (settingsEntries(lines.split("\0").filter(Boolean))) return true;
  }
  return false;
}

async function hasCommit(repo: string, sha: string): Promise<boolean> {
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}

/** The manifest as stored: checked, with names clipped */
function cleanManifest(
  value: unknown,
  sessionId: string,
  begin: BackupBegin
): BackupManifest {
  const m = value as BackupManifest;
  const bad = () => new BackupError("bad_request");
  if (!m || typeof m !== "object" || m.v !== 1) throw bad();
  if (m.sessionId !== sessionId) throw bad();
  if (m.claudeSessionId !== begin.claudeSessionId) throw bad();
  if (!!m.repo !== !!begin.repo) throw bad();
  if (m.repo) {
    if (!validManifest({ ...m, moveId: "0".repeat(16) })) throw bad();
    if (m.snapshot && m.snapshot.head !== m.repo.head) throw bad();
  } else if (m.snapshot !== null) {
    throw bad();
  }
  if (!isSafeModelName(m.model)) throw bad();
  const optional = (v: unknown, max: number): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" || v.length > max) throw bad();
    return v;
  };
  if (!Number.isSafeInteger(m.transcriptBytes) || m.transcriptBytes < 0) {
    throw bad();
  }
  return {
    v: 1,
    sessionId,
    name: clip(m.name, 80) || "Session",
    claudeSessionId: m.claudeSessionId,
    model: m.model,
    modelPinned: m.modelPinned === true,
    effort: optional(m.effort, 40),
    permissionMode: optional(m.permissionMode, 40),
    autoApprove: m.autoApprove === true,
    subagentModel:
      m.subagentModel && isSafeModelName(m.subagentModel)
        ? m.subagentModel
        : null,
    subagentOwnFirst: m.subagentOwnFirst === true,
    systemPrompt: optional(m.systemPrompt, 100_000),
    repo: m.repo
      ? {
          name: clip(m.repo.name, 300) || "project",
          remote: m.repo.remote,
          head: m.repo.head,
          branch: m.repo.branch,
          subdir: m.repo.subdir,
        }
      : null,
    snapshot: m.snapshot,
    projectName: clip(m.projectName, 80) || null,
    lastActiveAt: Number.isSafeInteger(m.lastActiveAt) ? m.lastActiveAt : 0,
    transcriptBytes: m.transcriptBytes,
  };
}

/** POST …/backup/[session]/commit {backupId, manifest}: the copy changes here */
export async function commitBackup(
  machine: MachineRow,
  sessionId: string,
  body: unknown,
  db: Database.Database = getDb(),
  now: number = Date.now()
): Promise<{ copiedAt: number }> {
  const input = body as { backupId?: unknown; manifest?: unknown };
  const { dir, begin } = await upload(machine.id, sessionId, input?.backupId);
  const manifest = cleanManifest(input?.manifest, sessionId, begin);
  const row = backupRow(machine.id, sessionId, db);
  // It arrived here since begin (a move, a take-over): no copy of it now
  const held = hubHolds(sessionId, machine.id, db);
  if (held) {
    throw new BackupError("taken", { taken: takenFromSession(held, row) });
  }
  if (row && row.state !== "current") {
    throw new BackupError(row.state === "taking" ? "taking" : "taken");
  }
  const over = startsOver(row, begin, dir);
  const part = path.join(dir, "conversation.part");
  const partBytes = (await fsp.lstat(part).catch(() => null))?.size ?? 0;
  const total = (over ? 0 : row!.file_bytes) + partBytes;
  if (manifest.transcriptBytes !== total) throw new BackupError("mismatch");

  // The code it names must all be here
  const key = begin.repo ? repoKeyOf(begin.repo) : null;
  const repo = key ? repoDir(machine.id, key) : null;
  let snapshotTree: string | null = null;
  let settings = false;
  if (repo && manifest.repo) {
    const head = manifest.repo.head;
    const snap = manifest.snapshot;
    if (
      !fs.existsSync(repo) ||
      !(await hasCommit(repo, head)) ||
      (snap && !(await hasCommit(repo, snap.commit)))
    ) {
      throw new BackupError("missing_code");
    }
    if (snap) {
      const tree = (
        await git(["rev-parse", `${snap.commit}^{tree}`], { cwd: repo })
      ).trim();
      if (tree !== snap.tree) throw new BackupError("missing_code");
      snapshotTree = tree;
    }
    settings = await hasSettings(repo, snap ? [head, snap.commit] : [head]);
  }

  // 1. The conversation: appended, or a new generation for a fresh start
  const gen = over ? (row ? row.file_gen + 1 : 0) : row!.file_gen;
  const live = conversationFile(machine.id, sessionId, gen);
  if (over) {
    await fsp.rm(live, { force: true });
    if (partBytes > 0) await fsp.rename(part, live);
    else await (await openForWrite(live, "create")).close();
  } else if (partBytes > 0) {
    const out = await openForWrite(live, "append");
    try {
      await pipeline(fs.createReadStream(part), out.createWriteStream());
    } finally {
      await out.close().catch(() => {});
    }
  }

  // 2. The row, only while no take-over has claimed it, and never for a
  // session that has moved away from that machine since its begin (checked
  // in the same step as the write, so a move can't slip in between)
  const write = db.transaction(() => {
    if (departed(machine.id, sessionId, db)) return -1;
    return db
      .prepare(
        `INSERT INTO machine_backups (machine_id, session_id, machine_name, name,
         project_name, claude_session_id, manifest, repo_key, head,
         snapshot_commit, snapshot_tree, file_gen, file_bytes, has_settings,
         copied_at, last_active_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current')
       ON CONFLICT (machine_id, session_id) DO UPDATE SET
         machine_name = excluded.machine_name, name = excluded.name,
         project_name = excluded.project_name,
         claude_session_id = excluded.claude_session_id,
         manifest = excluded.manifest, repo_key = excluded.repo_key,
         head = excluded.head, snapshot_commit = excluded.snapshot_commit,
         snapshot_tree = excluded.snapshot_tree, file_gen = excluded.file_gen,
         file_bytes = excluded.file_bytes, has_settings = excluded.has_settings,
         copied_at = excluded.copied_at,
         last_active_at = excluded.last_active_at
       WHERE machine_backups.state = 'current'`
      )
      .run(
        machine.id,
        sessionId,
        machine.name,
        manifest.name,
        manifest.projectName,
        manifest.claudeSessionId,
        JSON.stringify(manifest),
        manifest.repo ? key : null,
        manifest.repo?.head ?? null,
        manifest.snapshot?.commit ?? null,
        snapshotTree,
        gen,
        total,
        settings ? 1 : 0,
        now,
        manifest.lastActiveAt || null
      ).changes;
  });
  const changes = write();
  if (changes !== 1) {
    // A take-over claimed it meanwhile: what it reads is untouched
    if (over && (!row || gen !== row.file_gen)) {
      await fsp.rm(live, { force: true });
    }
    throw new BackupError(changes === -1 ? "stale" : "taking");
  }

  // 3. The refs, then what is no longer needed
  if (repo && manifest.repo) {
    await git(
      [
        "update-ref",
        `refs/agent-os/${sessionId}/backup-head`,
        manifest.repo.head,
      ],
      { cwd: repo }
    );
    if (manifest.snapshot) {
      await git(
        [
          "update-ref",
          `refs/agent-os/${sessionId}/backup`,
          manifest.snapshot.commit,
        ],
        { cwd: repo }
      );
    } else {
      await git(["update-ref", "-d", `refs/agent-os/${sessionId}/backup`], {
        cwd: repo,
      }).catch(() => {});
    }
    await dropIncomingRefs(repo, sessionId);
  }
  await fsp.rm(path.join(sessionDir(machine.id, sessionId), "incoming"), {
    recursive: true,
    force: true,
  });
  if (row && gen !== row.file_gen) {
    await fsp
      .rm(conversationFile(machine.id, sessionId, row.file_gen), {
        force: true,
      })
      .catch(() => {});
  }
  // Other machines' copies of this id stay: only a finished move
  // (lib/link/move.ts) says which one is out of date
  return { copiedAt: now };
}

/**
 * GET …/taken/[session]: whether this server still holds the session, so
 * the machine may not run its copy again
 */
export function takenHeld(
  machine: MachineRow,
  sessionId: string,
  db: Database.Database = getDb()
): { held: boolean } {
  checkSessionId(sessionId);
  if (hubHolds(sessionId, machine.id, db)) return { held: true };
  const taken = db
    .prepare(
      `SELECT 1 FROM machine_backups WHERE session_id = ? AND state = 'taken'`
    )
    .get(sessionId);
  return { held: !!taken };
}
