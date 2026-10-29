/**
 * Git badges for the file tree (E-Files, D-Files): each changed file's letter
 * and the folders with changes inside. Async and read-only (git status only).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { GitBadge } from "./git-types";

const execFileAsync = promisify(execFile);

/** One listing and its folders' expands within this hit the same status */
const TTL = 3_000;
const MAX_ENTRIES = 50;

export interface FileGitBadges {
  /** Absolute path -> letter; deleted files too (only their folders show) */
  files: Map<string, GitBadge>;
  /** Absolute paths of folders with a change somewhere inside */
  dirtyDirs: Set<string>;
}

interface RepoLocation {
  top: string;
  /** The folder relative to the top, "" or ending in "/" */
  prefix: string;
}

interface StatusEntry {
  /** Relative to the repository's top */
  path: string;
  badge: GitBadge;
}

const locations = new Map<
  string,
  { at: number; value: Promise<RepoLocation | null> }
>();
const statuses = new Map<
  string,
  { at: number; value: Promise<StatusEntry[]> }
>();

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 5_000,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** A promise per key, reused for TTL ms (concurrent callers share one run) */
function cached<T>(
  map: Map<string, { at: number; value: Promise<T> }>,
  key: string,
  run: () => Promise<T>
): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (map.size > MAX_ENTRIES) map.clear();
  const value = run();
  map.set(key, { at: Date.now(), value });
  return value;
}

/** Porcelain v1 XY -> the tree's letter: renames by their new path */
export function badgeOfPorcelain(xy: string): GitBadge {
  if (xy === "??") return "?";
  const [x, y] = xy;
  if (x === "D" || y === "D") return "D";
  if (x === "A" || x === "C") return "A";
  return "M";
}

/** `git status --porcelain=v1 -z` output -> entries (paths from the top) */
export function parsePorcelainZ(out: string): StatusEntry[] {
  const parts = out.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    // -z puts a rename's or copy's old path in the next field
    if (xy[0] === "R" || xy[0] === "C") i++;
    entries.push({ path: entry.slice(3), badge: badgeOfPorcelain(xy) });
  }
  return entries;
}

function locate(dir: string): Promise<RepoLocation | null> {
  return cached(locations, dir, async () => {
    const out = await git(dir, [
      "rev-parse",
      "--show-toplevel",
      "--show-prefix",
    ]);
    if (out === null) return null;
    const [top, prefix = ""] = out.split("\n");
    return top ? { top, prefix } : null;
  });
}

function repoStatus(top: string): Promise<StatusEntry[]> {
  return cached(statuses, top, async () => {
    const out = await git(top, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    return out === null ? [] : parsePorcelainZ(out);
  });
}

/**
 * The badges under `root` (a folder in a repository), keyed by absolute paths
 * built from `root` itself, so a symlinked root matches its listing. Empty
 * outside git.
 */
export async function gitBadges(root: string): Promise<FileGitBadges> {
  const files = new Map<string, GitBadge>();
  const dirtyDirs = new Set<string>();
  const dir = path.resolve(root);
  const where = await locate(dir);
  if (!where) return { files, dirtyDirs };

  for (const entry of await repoStatus(where.top)) {
    if (!entry.path.startsWith(where.prefix)) continue;
    const rel = entry.path.slice(where.prefix.length).replace(/\/$/, "");
    if (!rel) continue;
    const abs = path.join(dir, rel);
    files.set(abs, entry.badge);
    for (
      let d = path.dirname(abs);
      d.length > dir.length;
      d = path.dirname(d)
    ) {
      if (dirtyDirs.has(d)) break;
      dirtyDirs.add(d);
    }
  }
  return { files, dirtyDirs };
}

/** Tests: forget what was cached */
export function clearGitBadgesCache() {
  locations.clear();
  statuses.clear();
}
