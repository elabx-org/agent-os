/**
 * The PR poller (M8, flag prPoller): every PR_POLL_MS one async
 * `gh pr list --state all` per repo, matched to its sessions' branches,
 * written to the pr_* columns; a newly merged PR hands its session to
 * auto-settle. Started from lib/tickers.ts.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import type Database from "better-sqlite3";
import { gitCommonDir } from "./git-common-dir";
import { getDb, queries, type Project, type Session } from "./db";
import { getFlags } from "./flags";
import { foldChecks, isGhReady, pickPR, type GhPR } from "./pr";
import { autoSettlePass } from "./auto-settle";
import { wantWatch } from "./session-watch";
import { isEnded, PR_POLL_MS } from "./settle-types";

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 20_000;
const GH_LIMIT = 100;
const GH_FIELDS =
  "number,url,state,title,statusCheckRollup,headRefName,mergedAt,createdAt,isCrossRepository";

/** What one pass did */
export interface PrPollReport {
  repos: number;
  updated: number;
  /** Session ids whose PR was seen merged for the first time */
  merged: string[];
}

/** gh pr list's JSON as the poller asks for it */
export interface PolledPR extends GhPR {
  mergedAt?: string | null;
  isCrossRepository?: boolean;
}

/** What the pass needs from the world; tests swap in fakes */
export interface PrPollDeps {
  db: Database.Database;
  prPollerOn(): boolean;
  autoSettleOn(): boolean;
  ghReady(): Promise<boolean>;
  /** The git common dir of `dir` (shared by its worktrees); null when not a repo */
  repoKey(dir: string): Promise<string | null>;
  /** gh's PRs for the repo at `dir`; null when gh can't answer */
  listPrs(dir: string): Promise<PolledPR[] | null>;
  autoSettle(): Promise<number>;
}

async function ghListPrs(dir: string): Promise<PolledPR[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "all",
        "--json",
        GH_FIELDS,
        "--limit",
        String(GH_LIMIT),
      ],
      { cwd: dir, timeout: GH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    );
    const data: unknown = JSON.parse(stdout);
    return Array.isArray(data) ? (data as PolledPR[]) : null;
  } catch {
    return null;
  }
}

export function defaultPrPollDeps(): PrPollDeps {
  return {
    db: getDb(),
    prPollerOn: () => getFlags().prPoller,
    autoSettleOn: () => getFlags().autoSettle,
    ghReady: isGhReady,
    repoKey: gitCommonDir,
    listPrs: ghListPrs,
    autoSettle: () => autoSettlePass(),
  };
}

const expand = (dir: string) => dir.replace(/^~(?=$|\/)/, os.homedir());

/** The folder the session's branch lives in: its worktree, else its own or its project's */
export function sessionRepoDir(
  session: Pick<Session, "worktree_path" | "working_directory">,
  project: Pick<Project, "working_directory"> | null | undefined
): string | null {
  const own = session.working_directory;
  const dir =
    session.worktree_path ||
    (own && own !== "~" ? own : null) ||
    project?.working_directory ||
    own;
  return dir ? expand(dir) : null;
}

/** sessions.created_at (SQLite UTC "YYYY-MM-DD HH:MM:SS") in ms; NaN when unreadable */
function sqlTime(value: string | null | undefined): number {
  if (!value) return NaN;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : iso + "Z");
}

/** The pr_* columns a PR gives a session row */
export interface PrColumns {
  pr_url: string | null;
  pr_number: number;
  pr_status: "open" | "merged" | "closed";
  pr_title: string | null;
  pr_checks: string | null;
  pr_merged_at: number | null;
}

/**
 * The branch's PR among a repo's list, with pickPR's choice (open first,
 * else the most recent). Fork PRs don't count (their head is another
 * repo's branch), nor a PR merged or closed before the session existed (a
 * reused branch name). Null when there is none. Pure
 */
export function matchPr(
  prs: readonly PolledPR[],
  session: Pick<Session, "branch_name" | "created_at">
): PrColumns | null {
  const branch = session.branch_name;
  if (!branch) return null;
  const mine = prs.filter(
    (p) => p && p.headRefName === branch && !p.isCrossRepository
  );
  const pr = pickPR(mine) as PolledPR | null;
  if (!pr) return null;
  const state = (pr.state || "").toLowerCase();
  const status =
    state === "merged" ? "merged" : state === "closed" ? "closed" : "open";
  const mergedAt = pr.mergedAt ? Date.parse(pr.mergedAt) : NaN;
  if (status !== "open") {
    const born = sqlTime(session.created_at);
    const ended = Number.isFinite(mergedAt)
      ? mergedAt
      : Date.parse(pr.createdAt || "");
    if (Number.isFinite(born) && Number.isFinite(ended) && ended < born)
      return null;
  }
  return {
    pr_url: pr.url || null,
    pr_number: pr.number,
    pr_status: status,
    pr_title: pr.title || null,
    pr_checks: foldChecks(pr.statusCheckRollup),
    pr_merged_at:
      status === "merged" && Number.isFinite(mergedAt) ? mergedAt : null,
  };
}

/** True when the row already holds these columns */
export function samePr(
  session: Pick<Session, keyof PrColumns>,
  next: PrColumns
): boolean {
  return (Object.keys(next) as (keyof PrColumns)[]).every(
    (key) => (session[key] ?? null) === next[key]
  );
}

/**
 * One pass: the live sessions with a branch, grouped by repo (worktrees of
 * one repo share a gh call), one gh at a time; changed rows get one UPDATE
 * each, without touching updated_at so the lists keep their order. Then
 * auto-settle when its flag is on. Nothing while flag prPoller is off or
 * gh isn't signed in
 */
export async function pollPrsOnce(
  deps: PrPollDeps = defaultPrPollDeps()
): Promise<PrPollReport> {
  const report: PrPollReport = { repos: 0, updated: 0, merged: [] };
  if (!deps.prPollerOn()) return report;
  const { db } = deps;
  const sessions = (
    db
      .prepare(
        `SELECT * FROM sessions
         WHERE branch_name IS NOT NULL AND branch_name != ''
           AND settled_at IS NULL AND paused_at IS NULL`
      )
      .all() as Session[]
  ).filter((s) => !isEnded(s));
  if (!sessions.length) return report;
  if (!(await deps.ghReady())) return report;

  const projects = new Map<string, Project | undefined>();
  const project = (id: string | null) => {
    if (!id) return undefined;
    if (!projects.has(id))
      projects.set(id, queries.getProject(db).get(id) as Project | undefined);
    return projects.get(id);
  };

  // Repo (git common dir) -> a folder to run gh in and its sessions
  const repos = new Map<string, { dir: string; sessions: Session[] }>();
  const keys = new Map<string, string | null>();
  for (const session of sessions) {
    const dir = sessionRepoDir(session, project(session.project_id));
    if (!dir) continue;
    if (!keys.has(dir)) keys.set(dir, await deps.repoKey(dir));
    const key = keys.get(dir);
    if (!key) continue;
    const repo = repos.get(key) ?? { dir, sessions: [] };
    repo.sessions.push(session);
    repos.set(key, repo);
  }

  const update = db.prepare(
    `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ?,
       pr_title = ?, pr_checks = ?, pr_merged_at = ?
     WHERE id = ?`
  );
  for (const repo of repos.values()) {
    const prs = await deps.listPrs(repo.dir);
    if (!prs) continue;
    report.repos++;
    for (const session of repo.sessions) {
      const next = matchPr(prs, session);
      // No PR in gh's latest 100 isn't "no PR": keep what the row has
      if (!next || samePr(session, next)) continue;
      update.run(
        next.pr_url,
        next.pr_number,
        next.pr_status,
        next.pr_title,
        next.pr_checks,
        next.pr_merged_at,
        session.id
      );
      report.updated++;
      if (next.pr_status === "merged" && session.pr_status !== "merged")
        report.merged.push(session.id);
    }
  }

  if (deps.autoSettleOn()) {
    try {
      await deps.autoSettle();
    } catch (error) {
      console.error("[pr-poller] auto-settle:", error);
    }
  }
  return report;
}

const shared = globalThis as typeof globalThis & {
  __agentosPrPoller?: { started: boolean; busy: boolean };
};

/** Starts the poll once per process (server.ts and Next share it) */
export function startPrPoller(): void {
  const state = (shared.__agentosPrPoller ??= { started: false, busy: false });
  if (state.started) return;
  state.started = true;
  // Auto-settle weighs session-watch's status, so it keeps the poll alive
  wantWatch(() => {
    const flags = getFlags();
    return flags.prPoller && flags.autoSettle;
  });
  setInterval(async () => {
    if (state.busy || !getFlags().prPoller) return;
    state.busy = true;
    try {
      const report = await pollPrsOnce();
      if (report.merged.length)
        console.log(
          `[pr-poller] merged: ${report.merged.length} session(s) (${report.repos} repo(s))`
        );
    } catch (error) {
      console.error("[pr-poller] poll:", error);
    } finally {
      state.busy = false;
    }
  }, PR_POLL_MS).unref();
}
