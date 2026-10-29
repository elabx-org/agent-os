/**
 * M11: the sessions, files and commands sections of GET /api/search,
 * computed per request (messages come from the index, lib/search/query.ts).
 * The pure ranking and filtering is exported for the unit tests.
 */

import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Session } from "../db";
import { isRipgrepAvailable } from "../code-search";
import { flagOnFor } from "../flags";
import { getProject } from "../projects";
import {
  isConfigTrusted,
  projectIdForPath,
  readProjectConfig,
  seedInitialTrust,
  type ProjectScript,
} from "../project-config";
import { listClaudeCommands, type ClaudeCommand } from "../claude-commands";
import { sessionCwd } from "../transcript-locate";
import { listTurns } from "../turns";
import type { Turn } from "../turn-types";
import { queryTerms, termRanges } from "./highlight";
import { MIN_QUERY } from "./types";
import type {
  SearchCommand,
  SearchFileHit,
  SearchScriptCommand,
  SearchSessionHit,
  SearchSlashCommand,
  SearchTurnAction,
} from "./types";

/** Long enough to search (trimmed); shorter returns empty sections */
export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY;
}

// --- Sessions -----------------------------------------------------------------

/** How well one term matches a session: 0 = nowhere */
function termScore(term: string, name: string, others: string[]): number {
  if (name.startsWith(term)) return 4;
  const at = name.indexOf(term);
  if (at >= 0) {
    let from = at;
    while (from >= 0) {
      if (from === 0 || /[^\p{L}\p{N}]/u.test(name[from - 1])) return 3;
      from = name.indexOf(term, from + 1);
    }
    return 2;
  }
  return others.some((o) => o.includes(term)) ? 1 : 0;
}

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) as ISO; anything else as is */
export function sqliteToIso(value: string): string {
  return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
}

/**
 * Sessions whose name, branch, project name or folder name match every
 * word of the query, best first: a name that starts with a word, then a
 * word in the name, then anywhere in the name, then branch/project/folder;
 * ties newest first. Workers (conductor_session_id) are left out.
 */
export function searchSessions(
  query: string,
  sessions: Session[],
  projectNames: Map<string, string>,
  limit: number
): SearchSessionHit[] {
  const terms = queryTerms(query.trim());
  if (!terms.length) return [];
  const scored: { session: Session; score: number }[] = [];
  for (const session of sessions) {
    if (session.conductor_session_id) continue;
    const name = (session.name || "").toLowerCase();
    const projectName = session.project_id
      ? projectNames.get(session.project_id)
      : undefined;
    const others = [
      session.branch_name || "",
      projectName || "",
      path.basename(session.working_directory || ""),
    ].map((o) => o.toLowerCase());
    let score = 0;
    for (const term of terms) {
      const s = termScore(term, name, others);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score) scored.push({ session, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.session.updated_at || "").localeCompare(a.session.updated_at || "")
  );
  return scored.slice(0, limit).map(({ session }) => ({
    id: session.id,
    name: session.name,
    agentType: session.agent_type,
    projectId: session.project_id,
    projectName: session.project_id
      ? (projectNames.get(session.project_id) ?? null)
      : null,
    branch: session.branch_name,
    updatedAt: sqliteToIso(session.updated_at),
    nameRanges: termRanges(session.name, query.trim()),
  }));
}

// --- Files --------------------------------------------------------------------

/** One whole search; ripgrep and git get killed past this */
export const FILES_TIMEOUT_MS = 3000;
/** Outside a git repo (a session in ~, say) search only near the top */
const NON_GIT_MAX_DEPTH = 3;
/** rg --files / git ls-files output read at most */
const MAX_LIST_BYTES = 8 * 1024 * 1024;

/**
 * Runs a program (argv, no shell) and resolves with its stdout, whatever
 * the exit code (rg exits 1 on no match); "" when it cannot start. Killed
 * after `timeoutMs` or past `maxBytes` with what it printed so far.
 */
function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  maxBytes = MAX_LIST_BYTES
): Promise<string> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve("");
      return;
    }
    let child;
    try {
      child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve(Buffer.concat(chunks).toString("utf-8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    // The browser gave up on this search (a newer keystroke): stop now
    signal?.addEventListener("abort", finish, { once: true });
    child.stdout!.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBytes) finish();
    });
    child.on("error", finish);
    child.on("close", finish);
  });
}

function insideGitRepo(cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd, timeout: FILES_TIMEOUT_MS },
      (error, stdout) => resolve(!error && stdout.trim() === "true")
    );
  });
}

let rgAvailable: boolean | null = null;
function hasRipgrep(): boolean {
  if (rgAvailable === null) rgAvailable = isRipgrepAvailable();
  return rgAvailable;
}

/** For the tests: pretend ripgrep is (not) installed; null re-detects */
export function setRipgrepForTests(available: boolean | null): void {
  rgAvailable = available;
}

function stripDot(p: string): string {
  return p.startsWith("./") ? p.slice(2) : p;
}

/** Lines of `path\0count` (rg --count-matches --null) */
export function parseCounts(out: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    const nul = line.indexOf("\0");
    if (nul < 0) continue;
    const n = parseInt(line.slice(nul + 1), 10);
    if (n > 0) counts.set(stripDot(line.slice(0, nul)), n);
  }
  return counts;
}

/** Lines of `path\0line:text` (rg -n --null -m1) → first line per file */
export function parseFirstLines(out: string): Map<string, number> {
  const lines = new Map<string, number>();
  for (const line of out.split("\n")) {
    const nul = line.indexOf("\0");
    if (nul < 0) continue;
    const n = parseInt(line.slice(nul + 1), 10);
    const file = stripDot(line.slice(0, nul));
    if (n > 0 && !lines.has(file)) lines.set(file, n);
  }
  return lines;
}

/** Every term in the path (case-insensitive) */
export function pathMatches(file: string, terms: string[]): boolean {
  const lower = file.toLowerCase();
  return terms.every((t) => lower.includes(t));
}

/**
 * Path matches first, then by matching lines, then shorter paths; capped.
 * `content` maps a relative path to its matching lines.
 */
export function mergeFileHits(
  query: string,
  root: string,
  pathHits: string[],
  content: Map<string, number>,
  limit: number
): SearchFileHit[] {
  const byPath = new Map<string, { hits: number; pathMatch: boolean }>();
  for (const p of pathHits) byPath.set(p, { hits: 0, pathMatch: true });
  for (const [p, hits] of content) {
    const hit = byPath.get(p);
    if (hit) hit.hits = hits;
    else byPath.set(p, { hits, pathMatch: false });
  }
  return [...byPath.entries()]
    .sort(
      ([pa, a], [pb, b]) =>
        Number(b.pathMatch) - Number(a.pathMatch) ||
        b.hits - a.hits ||
        pa.length - pb.length ||
        pa.localeCompare(pb)
    )
    .slice(0, limit)
    .map(([p, hit]) => ({
      path: p,
      root,
      hits: hit.hits,
      pathRanges: termRanges(p, query),
    }));
}

/**
 * The folder to search, or null: an existing absolute directory, not "/",
 * and not the home folder itself unless it is a git repo. Outside git the
 * search stays within NON_GIT_MAX_DEPTH levels.
 */
async function searchRoot(
  root: string
): Promise<{ dir: string; git: boolean } | null> {
  if (!root || !path.isAbsolute(root)) return null;
  const dir = path.resolve(root);
  if (dir === path.parse(dir).root) return null;
  try {
    if (!(await fs.promises.stat(dir)).isDirectory()) return null;
  } catch {
    return null;
  }
  const git = await insideGitRepo(dir);
  if (!git && dir === path.resolve(os.homedir())) return null;
  return { dir, git };
}

/**
 * Files under `root` whose path holds every word of the query, or whose
 * content holds the query (ripgrep, fixed string, case-insensitive,
 * .gitignore respected). Without ripgrep: path matches from git ls-files.
 */
export async function searchFiles(
  query: string,
  root: string,
  limit: number,
  signal?: AbortSignal
): Promise<SearchFileHit[]> {
  const q = query.trim();
  const terms = queryTerms(q);
  if (!terms.length || limit <= 0) return [];
  const where = await searchRoot(root);
  if (!where) return [];
  const { dir, git } = where;
  const depth = git ? [] : [`--max-depth=${NON_GIT_MAX_DEPTH}`];
  const started = Date.now();
  const left = () => Math.max(200, FILES_TIMEOUT_MS - (Date.now() - started));

  if (!hasRipgrep()) {
    if (!git) return [];
    const out = await run(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      dir,
      left(),
      signal
    );
    const files = out.split("\0").filter((f) => f && pathMatches(f, terms));
    return mergeFileHits(q, dir, files, new Map(), limit);
  }

  const phrase = q.replace(/\s+/g, " ");
  const common = ["--max-filesize=1M", "-g", "!.git", ...depth];
  const [listOut, countOut] = await Promise.all([
    run("rg", ["--files", ...common, "."], dir, left(), signal),
    run(
      "rg",
      ["--count-matches", "-i", "-F", "--null", ...common, "--", phrase, "."],
      dir,
      left(),
      signal
    ),
  ]);
  const pathHits = listOut
    .split("\n")
    .map(stripDot)
    .filter((f) => f && pathMatches(f, terms));
  const counts = parseCounts(countOut);
  const hits = mergeFileHits(q, dir, pathHits, counts, limit);

  const withContent = hits.filter((h) => h.hits > 0).map((h) => h.path);
  if (withContent.length) {
    const linesOut = await run(
      "rg",
      [
        "-n",
        "-H",
        "-m1",
        "-i",
        "-F",
        "--null",
        "--no-heading",
        "--",
        phrase,
      ].concat(withContent.map((p) => `./${p}`)),
      dir,
      left(),
      signal
    );
    const first = parseFirstLines(linesOut);
    for (const hit of hits) {
      const line = first.get(hit.path);
      if (line) hit.line = line;
    }
  }
  return hits;
}

// --- Commands -----------------------------------------------------------------

/** Words an action answers to besides its label */
const ACTION_WORDS: Record<SearchTurnAction["action"], string[]> = {
  undo: ["undo", "turn", "revert"],
  diff: ["diff", "turn", "changes"],
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * An action matches when any word of the query starts a word of its label
 * or one of its words (so "undo turn" lists both Undo turn N and Open
 * diff: This turn).
 */
export function actionMatches(
  action: SearchTurnAction,
  terms: string[]
): boolean {
  const pool = [...words(action.label), ...ACTION_WORDS[action.action]];
  return terms.some((t) => pool.some((w) => w.startsWith(t)));
}

/** Whether any action could match: spares reading turns per keystroke */
export function mayMatchActions(terms: string[]): boolean {
  const pool = [
    ...words("Undo turn Open diff: This turn"),
    ...ACTION_WORDS.undo,
    ...ACTION_WORDS.diff,
  ];
  return terms.some(
    (t) => /^\d+$/.test(t) || pool.some((w) => w.startsWith(t))
  );
}

/** Every term somewhere in the text */
function allIn(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((t) => lower.includes(t));
}

/** Undo for the newest turn not undone, diff for the newest turn */
export function turnActions(
  sessionId: string,
  turns: Turn[]
): SearchTurnAction[] {
  const actions: SearchTurnAction[] = [];
  const withFiles = turns.filter((t) => t.files.length > 0);
  const undo = [...withFiles].reverse().find((t) => t.undoneAt === null);
  if (undo) {
    const n = undo.files.length;
    actions.push({
      kind: "action",
      id: `action:undo:${sessionId}:${undo.turnNo}`,
      label: `Undo turn ${undo.turnNo}`,
      detail: `Restores ${n} ${n === 1 ? "file" : "files"}, keeps chat above`,
      sessionId,
      action: "undo",
      turnNo: undo.turnNo,
    });
  }
  const last = withFiles[withFiles.length - 1];
  if (last) {
    const n = last.files.length;
    actions.push({
      kind: "action",
      id: `action:diff:${sessionId}:${last.turnNo}`,
      label: "Open diff: This turn",
      detail: `Turn ${last.turnNo} · ${n} ${n === 1 ? "file" : "files"}`,
      sessionId,
      action: "diff",
      turnNo: last.turnNo,
      added: last.added,
      removed: last.removed,
    });
  }
  return actions;
}

export function scriptCommands(
  projectId: string,
  scripts: ProjectScript[]
): SearchScriptCommand[] {
  return scripts.map((s) => ({
    kind: "script",
    id: `script:${projectId}:${s.id}`,
    label: `Run script: ${s.name}`,
    detail: s.command,
    projectId,
    scriptId: s.id,
  }));
}

export function slashCommands(
  sessionId: string,
  commands: ClaudeCommand[]
): SearchSlashCommand[] {
  const seen = new Set<string>();
  const out: SearchSlashCommand[] = [];
  for (const c of commands) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({
      kind: "slash",
      id: `slash:${c.name}`,
      label: `/${c.name}`,
      detail: c.description,
      command: `/${c.name} `,
      sessionId,
    });
  }
  return out;
}

/**
 * Filters and orders the candidates: actions, then scripts (every word in
 * the label or the command line), then slash commands (every word in the
 * name, a leading "/" ignored; names starting with the query first).
 */
export function filterCommands(
  query: string,
  candidates: {
    actions: SearchTurnAction[];
    scripts: SearchScriptCommand[];
    slash: SearchSlashCommand[];
  },
  limit: number
): SearchCommand[] {
  const terms = queryTerms(query.trim());
  if (!terms.length || limit <= 0) return [];
  const actions = candidates.actions.filter((a) => actionMatches(a, terms));
  const scripts = candidates.scripts.filter((s) =>
    allIn(`${s.label}\n${s.detail}`, terms)
  );
  const slashTerms = terms.map((t) => t.replace(/^\/+/, "")).filter(Boolean);
  const first = slashTerms[0] ?? "";
  const slash = slashTerms.length
    ? candidates.slash
        .filter((c) => allIn(c.label.slice(1), slashTerms))
        .map((c, i) => ({
          c,
          i,
          prefix: c.label.slice(1).toLowerCase().startsWith(first),
        }))
        .sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.i - b.i)
        .map(({ c }) => c)
    : [];
  return [...actions, ...scripts, ...slash].slice(0, limit);
}

async function projectScripts(
  projectId: string | null
): Promise<SearchScriptCommand[]> {
  if (!projectId) return [];
  const project = getProject(projectId);
  if (!project || project.is_uncategorized) return [];
  await seedInitialTrust();
  const read = await readProjectConfig(project.working_directory);
  if (!isConfigTrusted(projectId, read)) return [];
  return scriptCommands(projectId, read.effective.scripts ?? []);
}

function claudeSlash(session: Session | null): SearchSlashCommand[] {
  if (!session || session.agent_type !== "claude") return [];
  const groups = listClaudeCommands(sessionCwd(session));
  return slashCommands(session.id, [
    ...groups.builtin,
    ...groups.skills,
    ...groups.plugins,
    ...groups.user,
    ...groups.project,
  ]);
}

async function sessionActions(
  session: Session | null,
  terms: string[]
): Promise<SearchTurnAction[]> {
  // Same gate as GET /api/sessions/[id]/turns (`enabled`)
  if (!session || !flagOnFor("snapshots", session.id)) return [];
  if (!mayMatchActions(terms)) return [];
  return turnActions(session.id, await listTurns(session));
}

/**
 * Commands: the session's turn actions (Undo turn N, Open diff: This turn,
 * while snapshots are on), the project's scripts (trusted config only;
 * the project is `projectId`, else the one whose folder the session is
 * in) and, for Claude sessions, slash commands. In that order, capped.
 */
export async function searchCommands(
  query: string,
  opts: { session: Session | null; projectId: string | null; limit: number }
): Promise<SearchCommand[]> {
  const terms = queryTerms(query.trim());
  if (!terms.length || opts.limit <= 0) return [];
  const { session } = opts;
  const projectId =
    opts.projectId ?? (session ? projectIdForPath(sessionCwd(session)) : null);
  const [actions, scripts] = await Promise.all([
    sessionActions(session, terms).catch(() => []),
    projectScripts(projectId).catch(() => []),
  ]);
  let slash: SearchSlashCommand[] = [];
  try {
    slash = claudeSlash(session);
  } catch {
    slash = [];
  }
  return filterCommands(query, { actions, scripts, slash }, opts.limit);
}
