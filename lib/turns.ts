/**
 * Agent turns: the session_turns table (migration 26), turn boundaries from
 * the Claude hook's journal and, for Codex/Gemini, the dispatcher and the
 * running->idle edge; and undo, restricted to files the agent touched.
 *
 * Undo never runs checkout, restore or read-tree: it writes each file's pre
 * blob in place (temp file + rename), and only where the working file still
 * equals the turn's post snapshot, so the user's own edits and their index
 * stay as they are.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { getDb, type Session, type SessionTurnRow } from "./db";
import { claudeStateDir, readClaudeState } from "./claude-state";
import { flagOnFor } from "./flags";
import { setUndoNotice } from "./queue/store";
import { undoNoticeText } from "./queue/types";
import { latest } from "./session-watch";
import { snapshot } from "./snapshots";
import { git, gitBuffer, toplevel } from "./turns-git";
import type {
  Turn,
  TurnDetail,
  TurnFile,
  UndoRefusal,
  UndoResult,
} from "./turn-types";

/** Turns kept per session; older ones lose their refs and rows */
export const MAX_TURNS = 50;
const EXCERPT = 200;
const PRE_TIMEOUT_MS = 3000;
const POST_TIMEOUT_MS = 10_000;

export class TurnError extends Error {
  constructor(readonly reason: UndoRefusal | "not_found") {
    super(reason);
  }
}

export function sessionCwd(session: Session): string {
  const dir = session.worktree_path || session.working_directory || "~";
  return dir.replace(/^~(?=$|\/)/, os.homedir());
}

function isClaude(session: Session): boolean {
  return session.agent_type === "claude";
}

/** Agents whose turns AgentOS marks itself (no hooks) */
function marksOwnTurns(session: Session): boolean {
  return !isClaude(session) && session.agent_type !== "shell";
}

function excerpt(text: string): string | null {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > EXCERPT ? line.slice(0, EXCERPT) + "…" : line;
}

// One change at a time per session: the dispatcher, the idle edge and the
// routes can all reach the same turn
const shared = globalThis as unknown as {
  __agentosTurnLocks?: Map<string, Promise<unknown>>;
  __agentosTurnJournals?: Map<string, string>;
};
const locks = (shared.__agentosTurnLocks ??= new Map());
const journalSeen = (shared.__agentosTurnJournals ??= new Map());

function serial<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const before = locks.get(sessionId) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(sessionId, tail);
  void tail.then(() => {
    if (locks.get(sessionId) === tail) locks.delete(sessionId);
  });
  return run;
}

// --- Rows ------------------------------------------------------------------

function turnRows(sessionId: string): SessionTurnRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM session_turns WHERE session_id = ? ORDER BY turn_no"
    )
    .all(sessionId) as SessionTurnRow[];
}

function turnRow(sessionId: string, turnNo: number): SessionTurnRow | null {
  return (
    (getDb()
      .prepare(
        "SELECT * FROM session_turns WHERE session_id = ? AND turn_no = ?"
      )
      .get(sessionId, turnNo) as SessionTurnRow | undefined) ?? null
  );
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// --- The Claude hook's journal ----------------------------------------------

export interface JournalTurn {
  turnNo: number;
  cwd: string | null;
  promptExcerpt: string | null;
  transcriptUuid: string | null;
  preRef: string | null;
  postRef: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Absolute paths the agent's edit tools wrote */
  touched: string[];
}

/** turns.jsonl (scripts/agentos-snapshot.mjs) folded by turn, oldest first */
export function foldJournal(text: string): JournalTurn[] {
  const turns = new Map<number, JournalTurn>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const turnNo = e.turnNo;
    if (typeof turnNo !== "number" || !Number.isInteger(turnNo) || turnNo < 1)
      continue;
    let turn = turns.get(turnNo);
    if (!turn) {
      turn = {
        turnNo,
        cwd: null,
        promptExcerpt: null,
        transcriptUuid: null,
        preRef: null,
        postRef: null,
        startedAt: null,
        endedAt: null,
        touched: [],
      };
      turns.set(turnNo, turn);
    }
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    if (e.e === "pre") {
      turn.cwd = str(e.cwd);
      turn.promptExcerpt = str(e.promptExcerpt);
      turn.preRef = str(e.preRef);
      turn.startedAt = num(e.startedAt);
    } else if (e.e === "post") {
      turn.postRef = str(e.postRef);
      turn.transcriptUuid = str(e.transcriptUuid) ?? turn.transcriptUuid;
      turn.endedAt = num(e.endedAt);
    } else if (e.e === "touch") {
      const p = str(e.path);
      if (p && !turn.touched.includes(p)) turn.touched.push(p);
    }
  }
  return [...turns.values()].sort((a, b) => a.turnNo - b.turnNo);
}

function journalFile(sessionId: string): string | null {
  const dir = claudeStateDir(sessionId);
  return dir ? path.join(dir, "turns.jsonl") : null;
}

/** Upserts the journal's turns into session_turns when the file changed */
async function ingestJournal(session: Session): Promise<void> {
  if (!isClaude(session)) return;
  const file = journalFile(session.id);
  if (!file) return;
  let key: string;
  try {
    const st = fs.statSync(file);
    key = `${st.size}:${st.mtimeMs}`;
  } catch {
    return;
  }
  if (journalSeen.get(session.id) === key) return;
  const turns = foldJournal(fs.readFileSync(file, "utf8"));
  const newest = turns.length ? turns[turns.length - 1].turnNo : 0;
  const fallbackCwd = sessionCwd(session);
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO session_turns (session_id, turn_no, cwd, prompt_excerpt,
      transcript_uuid, pre_ref, post_ref, started_at, ended_at, touched_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, turn_no) DO UPDATE SET
      cwd = excluded.cwd,
      prompt_excerpt = excluded.prompt_excerpt,
      transcript_uuid = COALESCE(excluded.transcript_uuid, session_turns.transcript_uuid),
      files_json = CASE WHEN excluded.pre_ref IS session_turns.pre_ref
        AND excluded.post_ref IS session_turns.post_ref
        THEN session_turns.files_json ELSE NULL END,
      added = CASE WHEN excluded.pre_ref IS session_turns.pre_ref
        AND excluded.post_ref IS session_turns.post_ref
        THEN session_turns.added ELSE NULL END,
      removed = CASE WHEN excluded.pre_ref IS session_turns.pre_ref
        AND excluded.post_ref IS session_turns.post_ref
        THEN session_turns.removed ELSE NULL END,
      pre_ref = excluded.pre_ref,
      post_ref = excluded.post_ref,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      touched_json = excluded.touched_json`);
  db.transaction(() => {
    for (const t of turns) {
      // Pruned turns stay pruned
      if (t.turnNo <= newest - MAX_TURNS) continue;
      upsert.run(
        session.id,
        t.turnNo,
        t.cwd ?? fallbackCwd,
        t.promptExcerpt,
        t.transcriptUuid,
        t.preRef,
        t.postRef,
        t.startedAt,
        t.endedAt,
        JSON.stringify(t.touched)
      );
    }
  })();
  journalSeen.set(session.id, key);
  await pruneOldTurns(session.id);
}

// --- Refs ------------------------------------------------------------------

async function deleteRefs(cwd: string, refs: string[]): Promise<void> {
  if (refs.length === 0) return;
  try {
    await git(["update-ref", "--stdin"], {
      cwd,
      input: refs.map((r) => `delete ${r}\n`).join(""),
    });
  } catch {
    // The folder or repo is gone: nothing to keep tidy
  }
}

async function sessionRefs(cwd: string, sessionId: string): Promise<string[]> {
  try {
    return (
      await git(
        ["for-each-ref", "--format=%(refname)", `refs/agent-os/${sessionId}/`],
        { cwd }
      )
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Keeps the newest MAX_TURNS turns: older rows and every older
 * refs/agent-os/<id>/t<N>-* go (also refs of turns never ingested)
 */
async function pruneOldTurns(sessionId: string): Promise<void> {
  const rows = turnRows(sessionId);
  if (rows.length < MAX_TURNS) return;
  const keepFrom = rows[rows.length - MAX_TURNS].turn_no;
  for (const cwd of new Set(rows.map((r) => r.cwd))) {
    const old = (await sessionRefs(cwd, sessionId)).filter((ref) => {
      const m = ref.match(/\/t(\d+)-(?:pre|post)$/);
      return m && Number(m[1]) < keepFrom;
    });
    await deleteRefs(cwd, old);
  }
  getDb()
    .prepare("DELETE FROM session_turns WHERE session_id = ? AND turn_no < ?")
    .run(sessionId, keepFrom);
}

// --- Files changed -----------------------------------------------------------

/** Parses `git diff --numstat -z` and `--name-status -z` (no renames) */
export function parseChanges(numstat: string, nameStatus: string): TurnFile[] {
  const status = new Map<string, TurnFile["status"]>();
  const parts = nameStatus.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const s = parts[i][0];
    if (s === "A" || s === "D" || s === "M") status.set(parts[i + 1], s);
    else if (parts[i]) status.set(parts[i + 1], "M");
  }
  const files: TurnFile[] = [];
  for (const entry of numstat.split("\0")) {
    const m = entry.match(/^(-|\d+)\t(-|\d+)\t([\s\S]+)$/);
    if (!m) continue;
    files.push({
      path: m[3],
      status: status.get(m[3]) ?? "M",
      added: m[1] === "-" ? 0 : Number(m[1]),
      removed: m[2] === "-" ? 0 : Number(m[2]),
    });
  }
  return files;
}

/** The commit a turn is compared against: pre, else the previous snapshot */
async function baseOf(row: SessionTurnRow): Promise<string | null> {
  if (row.pre_ref) return row.pre_ref;
  if (!row.post_ref) return null;
  try {
    return (
      await git(["rev-parse", "--verify", "-q", `${row.post_ref}^`], {
        cwd: row.cwd,
      })
    ).trim();
  } catch {
    return null;
  }
}

async function changedFiles(
  cwd: string,
  base: string,
  head: string
): Promise<TurnFile[] | null> {
  try {
    const args = ["diff", "--no-renames", "--no-ext-diff", "-z"];
    const [numstat, nameStatus] = await Promise.all([
      git([...args, "--numstat", base, head, "--"], { cwd }),
      git([...args, "--name-status", base, head, "--"], { cwd }),
    ]);
    return parseChanges(numstat, nameStatus);
  } catch {
    return null;
  }
}

/** The turn's files, computed once its post snapshot exists and cached */
async function filesOf(row: SessionTurnRow): Promise<TurnFile[]> {
  if (row.files_json) return parseJson<TurnFile[]>(row.files_json, []);
  if (!row.post_ref) return [];
  const base = await baseOf(row);
  const files = base ? await changedFiles(row.cwd, base, row.post_ref) : null;
  if (!files) return [];
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  getDb()
    .prepare(
      "UPDATE session_turns SET files_json = ?, added = ?, removed = ? WHERE id = ?"
    )
    .run(JSON.stringify(files), added, removed, row.id);
  row.files_json = JSON.stringify(files);
  row.added = added;
  row.removed = removed;
  return files;
}

function toTurn(row: SessionTurnRow, files: TurnFile[]): Turn {
  return {
    turnNo: row.turn_no,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    files,
    added: row.added ?? files.reduce((n, f) => n + f.added, 0),
    removed: row.removed ?? files.reduce((n, f) => n + f.removed, 0),
    undoneAt: row.undone_at,
    transcriptUuid: row.transcript_uuid,
    promptExcerpt: row.prompt_excerpt,
  };
}

// --- Codex/Gemini turn boundaries ---------------------------------------------

function realish(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

function within(a: string, b: string): boolean {
  const rel = path.relative(a, b);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Same folder: one inside the other (agents in a checkout and a subfolder) */
function sharesFolder(a: string, b: string): boolean {
  const ra = realish(a);
  const rb = realish(b);
  return within(ra, rb) || within(rb, ra);
}

/**
 * Whether another session in the same folder may have changed files during
 * the turn: its own turn overlapped (session_turns), its Claude hooks say
 * it is busy, or the session watch sees it running
 */
function othersBusy(
  session: Session,
  row: SessionTurnRow,
  endedAt: number
): boolean {
  const db = getDb();
  const others = (
    db
      .prepare("SELECT * FROM sessions WHERE id != ?")
      .all(session.id) as Session[]
  ).filter((s) => sharesFolder(sessionCwd(s), row.cwd));
  const overlap = db.prepare(
    `SELECT 1 FROM session_turns WHERE session_id = ?
       AND COALESCE(started_at, 0) < ? AND COALESCE(ended_at, ?) > ? LIMIT 1`
  );
  const startedAt = row.started_at ?? 0;
  return others.some(
    (s) =>
      !!overlap.get(s.id, endedAt, endedAt, startedAt) ||
      (isClaude(s) && readClaudeState(s.id).busy === true) ||
      latest(s.id)?.status === "running"
  );
}

async function closeTurn(session: Session, row: SessionTurnRow): Promise<void> {
  const postRef = await snapshot(row.cwd, session.id, row.turn_no, "post", {
    timeoutMs: POST_TIMEOUT_MS,
  });
  const endedAt = Date.now();
  const closed = { ...row, post_ref: postRef, ended_at: endedAt };
  const base = postRef ? await baseOf(closed) : null;
  const files =
    base && postRef ? await changedFiles(row.cwd, base, postRef) : null;
  // No tool hooks: all of it is the agent's unless someone else was busy
  const top = files ? await toplevel(row.cwd) : null;
  const touched =
    files && top && !othersBusy(session, row, endedAt)
      ? files.map((f) => path.join(top, f.path))
      : [];
  getDb()
    .prepare(
      `UPDATE session_turns SET post_ref = ?, ended_at = ?, files_json = ?,
         added = ?, removed = ?, touched_json = ? WHERE id = ?`
    )
    .run(
      postRef,
      endedAt,
      files ? JSON.stringify(files) : null,
      files ? files.reduce((n, f) => n + f.added, 0) : null,
      files ? files.reduce((n, f) => n + f.removed, 0) : null,
      JSON.stringify(touched),
      row.id
    );
}

function openTurn(sessionId: string): SessionTurnRow | null {
  const rows = turnRows(sessionId);
  const last = rows[rows.length - 1];
  return last && !last.post_ref && !last.ended_at ? last : null;
}

/**
 * The session's running->idle edge (lib/tickers.ts subscribes it to
 * lib/session-watch.ts): Codex/Gemini take their post snapshot; Claude's
 * turns are ingested from the hook's journal
 */
export async function onIdleEdge(session: Session): Promise<void> {
  if (!flagOnFor("snapshots", session.id)) return;
  await serial(session.id, async () => {
    if (isClaude(session)) return ingestJournal(session);
    if (!marksOwnTurns(session)) return;
    const open = openTurn(session.id);
    if (open) await closeTurn(session, open);
  });
}

/**
 * Before the dispatcher types a message into a Codex/Gemini session: the
 * turn's pre snapshot. Claude's comes from its UserPromptSubmit hook
 */
export async function beforeAgentSend(
  session: Session,
  text: string
): Promise<void> {
  if (!marksOwnTurns(session) || !flagOnFor("snapshots", session.id)) return;
  await serial(session.id, async () => {
    const cwd = sessionCwd(session);
    if (!(await toplevel(cwd))) return;
    // The last turn missed its idle edge (e.g. a restart): it ends here
    const open = openTurn(session.id);
    if (open) await closeTurn(session, open);
    const rows = turnRows(session.id);
    const turnNo = (rows[rows.length - 1]?.turn_no ?? 0) + 1;
    const startedAt = Date.now();
    const preRef = await snapshot(cwd, session.id, turnNo, "pre", {
      timeoutMs: PRE_TIMEOUT_MS,
    });
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO session_turns
           (session_id, turn_no, cwd, prompt_excerpt, pre_ref, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(session.id, turnNo, cwd, excerpt(text), preRef, startedAt);
    await pruneOldTurns(session.id);
  });
}

// --- Reading -------------------------------------------------------------------

/** Newest last; empty when snapshots are off for the session */
export async function listTurns(session: Session): Promise<Turn[]> {
  if (!flagOnFor("snapshots", session.id)) return [];
  await serial(session.id, () => ingestJournal(session));
  const turns: Turn[] = [];
  for (const row of turnRows(session.id)) {
    turns.push(toTurn(row, await filesOf(row)));
  }
  return turns;
}

/** A recorded path as a path in the repo, or null when outside it */
function repoPath(realTop: string, cwd: string, p: string): string | null {
  const rel = path.relative(realTop, realish(path.resolve(cwd, p)));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel.split(path.sep).join("/")
    : null;
}

export async function turnDetail(
  session: Session,
  turnNo: number
): Promise<TurnDetail | null> {
  if (!flagOnFor("snapshots", session.id)) return null;
  await serial(session.id, () => ingestJournal(session));
  const row = turnRow(session.id, turnNo);
  if (!row) return null;
  const top = await toplevel(row.cwd);
  if (!top) {
    return {
      files: [],
      touched: [],
      alsoChanged: [],
      undoable: false,
      reason: "not_git",
    };
  }
  const realTop = realish(top);
  const changed = await filesOf(row);
  const touched = [
    ...new Set(
      parseJson<string[]>(row.touched_json, [])
        .map((p) => repoPath(realTop, row.cwd, p))
        .filter((p): p is string => !!p)
    ),
  ];
  const mine = new Set(touched);
  const reason: UndoRefusal | undefined = row.undone_at
    ? "undone"
    : !row.pre_ref || (!row.post_ref && row.ended_at)
      ? "no_snapshot"
      : !row.post_ref
        ? "running"
        : undefined;
  return {
    files: changed.filter((f) => mine.has(f.path)),
    touched,
    alsoChanged: changed.filter((f) => !mine.has(f.path)),
    undoable: !reason,
    ...(reason ? { reason } : {}),
  };
}

/** What a turn's diff compares: pre (or the previous snapshot) to post */
export async function turnRange(
  session: Session,
  turnNo: number
): Promise<{ cwd: string; base: string | null; head: string | null } | null> {
  if (!flagOnFor("snapshots", session.id)) return null;
  await serial(session.id, () => ingestJournal(session));
  const row = turnRow(session.id, turnNo);
  if (!row) return null;
  return { cwd: row.cwd, base: await baseOf(row), head: row.post_ref };
}

// --- Undo ----------------------------------------------------------------------

interface TreeEntry {
  mode: string;
  sha: string;
}

async function treeEntries(
  cwd: string,
  ref: string,
  paths: string[]
): Promise<Map<string, TreeEntry>> {
  const out = await git(
    [
      "--literal-pathspecs",
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      ref,
      "--",
      ...paths,
    ],
    { cwd }
  );
  const entries = new Map<string, TreeEntry>();
  for (const item of out.split("\0")) {
    const m = item.match(/^(\d+) \w+ ([0-9a-f]+)\t([\s\S]+)$/);
    if (m) entries.set(m[3], { mode: m[1], sha: m[2] });
  }
  return entries;
}

/** The working file as a blob id ("link:" + id for a symlink), null if absent */
async function workingBlobs(
  top: string,
  paths: string[]
): Promise<Map<string, string | null | undefined>> {
  const result = new Map<string, string | null | undefined>();
  const files: string[] = [];
  for (const p of paths) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(path.join(top, p));
    } catch {
      result.set(p, null);
      continue;
    }
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(path.join(top, p));
      const sha = await git(["hash-object", "--stdin"], {
        cwd: top,
        input: target,
      });
      result.set(p, "link:" + sha.trim());
    } else if (st.isFile() && !p.includes("\n")) {
      files.push(p);
    } else {
      // A folder now, or a name hash-object can't take: leave it alone
      result.set(p, undefined);
    }
  }
  if (files.length > 0) {
    // Clean filters and line endings apply by path, as `git add` did
    const shas = (
      await git(["hash-object", "--stdin-paths"], {
        cwd: top,
        input: files.join("\n") + "\n",
      })
    )
      .trim()
      .split("\n");
    files.forEach((p, i) => result.set(p, shas[i] ?? undefined));
  }
  return result;
}

function entryBlob(entry: TreeEntry | undefined): string | null | undefined {
  if (!entry) return null;
  if (entry.mode === "120000") return "link:" + entry.sha;
  if (entry.mode === "100644" || entry.mode === "100755") return entry.sha;
  return undefined; // A submodule
}

function writeAtomic(
  file: string,
  content: Buffer,
  entry: TreeEntry,
  current: fs.Stats | null
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.agentos-${process.pid}-${Date.now()}`
  );
  try {
    if (entry.mode === "120000") {
      fs.symlinkSync(content.toString("utf8"), tmp);
    } else {
      const base = current && current.isFile() ? current.mode & 0o777 : 0o644;
      const mode =
        entry.mode === "100755" ? base | ((base & 0o444) >> 2) : base & ~0o111;
      fs.writeFileSync(tmp, content, { mode });
      fs.chmodSync(tmp, mode);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function lstatOrNull(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

/**
 * Restores each path's pre content where the working file still equals
 * post (else kept), then stores the undo notice (lib/queue/store.ts
 * setUndoNotice). The caller checks requireUser and that the session is idle
 */
export async function undoTurn(
  session: Session,
  turnNo: number,
  paths: string[],
  options: { notify?: (sessionId: string, text: string) => unknown } = {}
): Promise<UndoResult> {
  const notify = options.notify ?? setUndoNotice;
  const detail = await turnDetail(session, turnNo);
  if (!detail) throw new TurnError("not_found");
  if (!detail.undoable) throw new TurnError(detail.reason ?? "no_snapshot");
  return serial(session.id, async () => {
    const row = turnRow(session.id, turnNo);
    const top = row && (await toplevel(row.cwd));
    if (!row || !row.pre_ref || !row.post_ref)
      throw new TurnError("no_snapshot");
    if (!top) throw new TurnError("not_git");

    const offered = new Set(
      [...detail.files, ...detail.alsoChanged].map((f) => f.path)
    );
    const selected = [...new Set(paths)].filter((p) => offered.has(p));
    if (selected.length === 0) return { reverted: [], kept: [] };
    const [pre, post, working] = await Promise.all([
      treeEntries(top, row.pre_ref, selected),
      treeEntries(top, row.post_ref, selected),
      workingBlobs(top, selected),
    ]);

    const reverted: string[] = [];
    const kept: UndoResult["kept"] = [];
    for (const p of selected) {
      const now = working.get(p);
      const then = entryBlob(post.get(p));
      const before = pre.get(p);
      if (
        now === undefined ||
        then === undefined ||
        now !== then ||
        (before && entryBlob(before) === undefined)
      ) {
        kept.push({ path: p, reason: "changed_since" });
        continue;
      }
      const file = path.join(top, p);
      if (!before) {
        // Added in the turn
        fs.rmSync(file, { force: true });
      } else {
        const content = await gitBuffer(["cat-file", "blob", before.sha], {
          cwd: top,
        });
        writeAtomic(file, content, before, lstatOrNull(file));
      }
      reverted.push(p);
    }

    if (reverted.length > 0) {
      getDb()
        .prepare("UPDATE session_turns SET undone_at = ? WHERE id = ?")
        .run(Date.now(), row.id);
      notify(session.id, undoNoticeText(turnNo, reverted));
    }
    return { reverted, kept };
  });
}

// --- Prune -----------------------------------------------------------------------

async function deleteSessionRefs(
  cwd: string,
  sessionId: string
): Promise<void> {
  await deleteRefs(cwd, await sessionRefs(cwd, sessionId));
  try {
    const dir = (
      await git(["rev-parse", "--git-path", "agent-os"], { cwd })
    ).trim();
    fs.rmSync(path.resolve(cwd, dir, `index-${sessionId}`), { force: true });
  } catch {
    // Not a repo (any more)
  }
}

/** Deletes the session's refs/agent-os/<id>/* and turn rows (session delete) */
export async function pruneSessionTurns(session: Session): Promise<void> {
  await serial(session.id, async () => {
    const cwds = new Set([
      sessionCwd(session),
      ...turnRows(session.id).map((r) => r.cwd),
    ]);
    for (const cwd of cwds) await deleteSessionRefs(cwd, session.id);
    getDb()
      .prepare("DELETE FROM session_turns WHERE session_id = ?")
      .run(session.id);
    const dir = claudeStateDir(session.id);
    if (dir) {
      fs.rmSync(path.join(dir, "turns.jsonl"), { force: true });
      fs.rmSync(path.join(dir, "turn.json"), { force: true });
    }
    journalSeen.delete(session.id);
  });
}

/**
 * Prunes the turns of sessions settled longer than `olderThanMs` ago
 * (sessions.settled_at, added by M8; nothing to do before it exists).
 * Returns how many sessions it pruned
 */
export async function pruneSettled(olderThanMs: number): Promise<number> {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === "settled_at")) return 0;
  const cutoff = Date.now() - olderThanMs;
  const settled = (
    db
      .prepare(
        `SELECT s.*, s.settled_at AS settled FROM sessions s
         WHERE s.settled_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM session_turns t WHERE t.session_id = s.id)`
      )
      .all() as (Session & { settled: number | string })[]
  ).filter((s) => {
    const at =
      typeof s.settled === "number" ? s.settled : Date.parse(String(s.settled));
    return Number.isFinite(at) && at < cutoff;
  });
  for (const session of settled) await pruneSessionTurns(session);
  return settled.length;
}
